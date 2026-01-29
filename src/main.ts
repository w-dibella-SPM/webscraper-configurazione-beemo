import type { BrowserContext, Locator, Page } from "playwright";
import { chromium } from "playwright";
import * as fs from "node:fs";
import dotenv from "dotenv";
import { expect } from "playwright/test";

type LogLevel = "log" | "info" | "warn" | "error";

type ArticoloDaConfigurare = {
    famiglia: string,
    prodotto: string,
};

type ArticoloConfigurato = ArticoloDaConfigurare & {
    priorita: string,
};

dotenv.config({
    path: "../.env",
});

const LOG_MESSAGE_PREFIX = {
    SKIP: "SKIP",
    NO_ACTIVITIES_IN_MODEL: "NO_ACTIVITIES_IN_MODEL",
    NO_MODEL_FOUND: "NO_MODEL_FOUND",
    NO_BEEMO_CONFIG_FOUND: "NO_BEEMO_CONFIG_FOUND",
    PRODUCT_CONFIGURED_SUCCESSFULLY: "PRODUCT_CONFIGURED_SUCCESSFULLY",
    CONFIGURATION_NOT_SAVED_BY_USER: "CONFIGURATION_NOT_SAVED_BY_USER",
};

const SM2CARE_USERNAME: string = process.env.SM2CARE_USERNAME || "";
const SM2CARE_PASSWORD: string = process.env.SM2CARE_PASSWORD || "";
const SM2CARE_BASE_URL = "http://172.23.0.111/";
const SM2CARE_LOGIN_PAGE_URL = `${SM2CARE_BASE_URL}login.php`;
const SM2CARE_HOMEPAGE_URL = `${SM2CARE_BASE_URL}index.php`;

function applyLogLevel(): void {
    const emptyFunction = (): void => {};
    const logLevels: LogLevel[] = ["log", "info", "warn", "error"];
    const logsToShow: LogLevel[] = process.env.LOG_LEVEL?.split(",") as LogLevel[] || [];

    for (const logLevel of logLevels) {
        if (!logsToShow.includes(logLevel)) {
            console[logLevel] = emptyFunction;
        }
    }
}

function getArticoliDaConfigurare(): Map<string, ArticoloDaConfigurare> {
    const entries = fs
        .readFileSync("../static/pris_articoli_da_fare.csv", "utf-8")
        .split("\n")
        .slice(1)
        .filter(l => l.trim().length > 0)
        .map(l => {
            const [ famiglia, prodotto ] = l.split(",").map(s => s.trim());
            return [ `${famiglia}${prodotto}`, { famiglia, prodotto }] as [string, ArticoloDaConfigurare];
        });

    return new Map(entries);
}

function saveArticoliDaConfigurare(articoliDaConfigurare: Map<string, ArticoloDaConfigurare>, articoliConfigurati: Map<string, ArticoloConfigurato>): void {
    const lines: string[] = ["Famiglia,Prodotto"];
    for (const [keyArticoloDaConfigurare, articoloDaConfigurare] of articoliDaConfigurare) {
        if (!articoliConfigurati.has(keyArticoloDaConfigurare)) {
            lines.push(`${articoloDaConfigurare.famiglia},${articoloDaConfigurare.prodotto}`);
        }
    }

    fs.writeFileSync("../static/pris_articoli_da_fare.csv", lines.join("\n"));
}

async function countRowsInTBody(trLocator: Locator, page: Page): Promise<number> {
    await page.waitForLoadState("networkidle");

    let prevCount: number = -1;
    let count: number = await trLocator.count();

    while (prevCount !== count) {
        prevCount = count;
        await page.waitForTimeout(500);
        count = await trLocator.count();
    }
    return count;
}

async function handleConfigurazionePerArticolo(articoloDaConfigurare: ArticoloDaConfigurare, articoliPrisPage: Page, nth: number): Promise<ArticoloConfigurato | undefined> {
    type OptionalValue<T> = { present: true, value: T } | { present: false };

    type Attivita = {
        idModello: string,
        prioritaModello: string,
        codice: string;
        operazione: string;
        ok: OptionalValue<boolean>,
        ko: OptionalValue<boolean>,
        costoAttivita: OptionalValue<number>;
        costoIndustrialeModello: number;
    };

    const prioritaCellInnerText: string =
        await articoliPrisPage.locator(`#id_table_pris_articoli > tbody > tr:nth-child(${nth}) > td:nth-child(4)`).innerText();

    if (prioritaCellInnerText !== "J") {
        console.info(`${LOG_MESSAGE_PREFIX.SKIP}: priorità diversa da J per l'articolo ${articoloDaConfigurare.prodotto} (priorità: ${prioritaCellInnerText}).`);
    }
    else {
        try {
            // Click su modifica
            await articoliPrisPage.click(`#id_table_pris_articoli > tbody > tr:nth-child(${nth}) > td.text-right.all.avoid-selection > a.btn.btn-blue`);

            // Controlla che attività ci sono per il modello con priorità J

            // Mostra 100 attività
            await articoliPrisPage.selectOption("#id_table_pris_articoli_modprod_length > label > select", "100");

            const attivitaModelloRowLocator: Locator = articoliPrisPage.locator("#id_table_pris_articoli_modprod > tbody > tr");
            const attivitaModelloCount: number = await countRowsInTBody(attivitaModelloRowLocator, articoliPrisPage);

            if (attivitaModelloCount === 0 || await attivitaModelloRowLocator.nth(0).locator("td").nth(0).getAttribute("class") === "dataTables_empty") {
                console.error(`${LOG_MESSAGE_PREFIX.NO_ACTIVITIES_IN_MODEL}: trovato modello con priorità J senza attività per l'articolo:`, articoloDaConfigurare);
                await articoliPrisPage.click("#id_pris_articoli_configForm > div.modal-footer > button.btn.btn-white");
                return undefined;
            }

            // Prendi il costo industriale del modello
            const costoIndustrialeModello: number = Number(await articoliPrisPage.inputValue("#id_pris_articoli_costo_industriale"));

            const elencoAttivitaModelloPrioritaJ: Attivita[] = [];
            for (let i = 0, nth = 1; i < attivitaModelloCount; i++, nth++) {
                const [ okThumbLocator, koThumbLocator, costoLocator ]: [ Locator, Locator, Locator ] = [
                    attivitaModelloRowLocator.nth(i).locator("td:nth-child(7) > a > i"),
                    attivitaModelloRowLocator.nth(i).locator("td:nth-child(8) > a > i"),
                    attivitaModelloRowLocator.nth(i).locator("td:nth-child(9) > div > div > input"),
                ];

                const [ idModello, prioritaModello, operazione, codice, ok, ko, costoAttivita ]: [
                    string,
                    string,
                    string,
                    string,
                    OptionalValue<boolean>,
                    OptionalValue<boolean>,
                    OptionalValue<number>
                ] = [
                    await attivitaModelloRowLocator.nth(i).locator("td:nth-child(1)").first().innerText(),
                    await attivitaModelloRowLocator.nth(i).locator("td:nth-child(2)").innerText(),
                    await attivitaModelloRowLocator.nth(i).locator("td:nth-child(3)").innerText(),
                    await attivitaModelloRowLocator.nth(i).locator("td:nth-child(4)").innerText(),
                    await (async (): Promise<OptionalValue<boolean>> => {
                        if (await okThumbLocator.count() > 0) {
                            return {
                                present: true,
                                value: !!(await okThumbLocator.getAttribute("class"))?.includes("thumbs-up"),
                            };
                        }
                        return { present: false };
                    })(),
                    await (async (): Promise<OptionalValue<boolean>> => {
                        if (await koThumbLocator.count() > 0) {
                            return {
                                present: true,
                                value: !!(await koThumbLocator.getAttribute("class"))?.includes("thumbs-up"),
                            };
                        }
                        return { present: false };
                    })(),
                    await (async (): Promise<OptionalValue<number>> => {
                        if (await costoLocator.count() > 0) {
                            return {
                                present: true,
                                value: Number(await costoLocator.inputValue()),
                            }
                        }
                        return { present: false };
                    })()
                ];

                elencoAttivitaModelloPrioritaJ.push({
                    idModello,
                    prioritaModello,
                    operazione,
                    codice,
                    ok,
                    ko,
                    costoAttivita,
                    costoIndustrialeModello
                });
            }
            console.info("Elenco attività modello priorità J:", elencoAttivitaModelloPrioritaJ);

            // Chiudi la finestra di modifica
            await articoliPrisPage.click("#id_pris_articoli_configForm > div.modal-footer > button.btn.btn-white");

            // Controlla i modelli disponibili

            // Clicca su "+"
            await articoliPrisPage.click("#id_pris_articoli_nuovo");

            // Clicca sulla combobox
            await articoliPrisPage.click("#id_pris_articoli_configForm > div.modal-body > div:nth-child(1) > div > span");
            // Cerca i modelli disponibili per l'articolo da fare
            await articoliPrisPage.fill("body > span > span > span.select2-search.select2-search--dropdown > input", articoloDaConfigurare.prodotto);

            // Clicca sulla prima opzione
            await articoliPrisPage.click("#select2-id_pris_articoli_codice-results > li:nth-child(1)");

            // Clicca su "importa modello"
            await articoliPrisPage.click("#id_pris_articoli_modprod_import");

            const modelliDisponibiliRowsLocator: Locator = articoliPrisPage.locator("#id_table_panth_modprod > tbody > tr");
            const modelliDisponibiliCount: number = await countRowsInTBody(modelliDisponibiliRowsLocator, articoliPrisPage);

            for (let i = 0; i < modelliDisponibiliCount; i++) {
                // Clicca sul modello (i)
                await modelliDisponibiliRowsLocator.nth(i).click();

                // Mostra 100 attività
                await articoliPrisPage.selectOption("#id_table_panth_modprod_d_length > label > select", "100");

                const attivitaModelloPanthRowLocator: Locator = articoliPrisPage.locator("#id_table_panth_modprod_d > tbody > tr");
                const attivitaModelloPanthCount: number = await countRowsInTBody(attivitaModelloPanthRowLocator, articoliPrisPage);

                // Se il numero di attività non coincide, vai al modello successivo
                if (attivitaModelloPanthCount !== elencoAttivitaModelloPrioritaJ.length) {
                    console.info(`Il numero di attività non coincide:\tpanth: ${attivitaModelloPanthCount}\tmodello priorità j: ${elencoAttivitaModelloPrioritaJ.length}`);
                    continue;
                }

                let attivitaNonCoincidente: Attivita | undefined;
                for (let j = 0; j < attivitaModelloPanthCount; j++) {
                    const [ operazione, codice ]: [ string, string ] = [
                        await attivitaModelloPanthRowLocator.nth(j).locator("td.text-left.all.sorting_1.dtr-control").innerText(),
                        await attivitaModelloPanthRowLocator.nth(j).locator("td:nth-child(2)").innerText(),
                    ];

                    if (
                        operazione.trim() !== elencoAttivitaModelloPrioritaJ[j].operazione.trim() ||
                        codice.trim() !== elencoAttivitaModelloPrioritaJ[j].codice.trim()
                    ) {
                        attivitaNonCoincidente = elencoAttivitaModelloPrioritaJ[j];
                    }
                }

                // Se una delle attività non coincide, vai al modello successivo
                if (attivitaNonCoincidente) {
                    console.info("La seguente attività non coincide:", attivitaNonCoincidente);
                    continue;
                }

                // Se tutte le attività coincidono, seleziona il modello
                await modelliDisponibiliRowsLocator.nth(i).locator("td.text-left.all.dtr-control > a").click();

                // Importa il modello
                await articoliPrisPage.click("#id_pris_articoli_modprod_modal_importa");
                // Aspetta che la finestra di importazione sia chiusa
                await articoliPrisPage.locator("#id_pris_articoli_modprod_modal").waitFor({ state: "hidden", timeout: 0 });

                // Mostra 100 attività
                await articoliPrisPage.selectOption("#id_table_pris_articoli_modprod_length > label > select", "100");

                // Setta il costo industriale
                await articoliPrisPage.fill("#id_pris_articoli_costo_industriale", String(costoIndustrialeModello));

                // Configura il modello nuovo con i parametri del modello vecchio (priorità J = vecchio)
                for (let i = 0, nth = 1; i < elencoAttivitaModelloPrioritaJ.length; i++, nth++) {
                    const attivita: Attivita = elencoAttivitaModelloPrioritaJ[i];
                    const attivitaModelloConfigRowLocator: Locator = articoliPrisPage.locator(`#id_table_pris_articoli_modprod > tbody > tr:nth-child(${nth})`);

                    if (attivita.ok.present && attivita.ok.value) {
                        await attivitaModelloConfigRowLocator.locator("td:nth-child(7) > a").click();
                    }
                    if (attivita.ko.present && attivita.ko.value) {
                        await attivitaModelloConfigRowLocator.locator("td:nth-child(8) > a").click();
                    }
                    if (attivita.costoAttivita.present && attivita.costoAttivita.value) {
                        await attivitaModelloConfigRowLocator.locator("td:nth-child(9) > div > div > input").fill(String(attivita.costoAttivita));
                    }
                }

                await articoliPrisPage.evaluate(() => alert("Verifica la configurazione. Se ritieni che sia corretta, clicca su \"Salva\", altrimenti su \"Chiudi\". Clicca \"Ok\" per chiudere questo messaggio."));

                const configurazioneSalvata: boolean = await articoliPrisPage.locator("#id_pris_articoli_config_modal").evaluate(async () => {
                    return await new Promise(resolve => {
                        const btnSalva = document.querySelector("body > div.swal2-container > div.swal2-modal.hide-swal2 > button.swal2-confirm.styled");
                        const btnChiudi = document.querySelector("#id_pris_articoli_configForm > div.modal-footer > button.btn.btn-white");

                        btnSalva?.addEventListener("click", () => resolve(true));
                        btnChiudi?.addEventListener("click", () => resolve(false));
                    });
                });

                if (!configurazioneSalvata) {
                    console.info(`${LOG_MESSAGE_PREFIX.CONFIGURATION_NOT_SAVED_BY_USER}: la configurazione non è stata salvata (è stato schiacciato "chiudi").`);

                }

                const configurationAlreadyExistsToastLocator: Locator = articoliPrisPage.locator(
                        "#toast-container > div > div.toast-message",
                        { hasText: "SyntaxError: Unexpected end of JSON input" }
                    );

                try {
                    // Se compare il toast che segnala che la configurazione per quel modello esiste già,
                    // vai al modello successivo.
                    await expect(configurationAlreadyExistsToastLocator).toHaveCount(1, { timeout: 2000 });

                    // Clicca su "importa modello"
                    await articoliPrisPage.click("#id_pris_articoli_modprod_import");
                    continue;
                }
                catch {
                    /* do nothing */
                }

                // Aspetta che il popup di configurazione del modello si sia chiuso
                await articoliPrisPage.locator("#id_pris_articoli_config_modal").waitFor({ state: "hidden" });

                return configurazioneSalvata
                    ? { ...articoloDaConfigurare, priorita: elencoAttivitaModelloPrioritaJ[0].prioritaModello }
                    : undefined;
            }

            // Se sono arrivato fino a qui, vuol dire che non ho trovato nessun modello.
            console.error(`${LOG_MESSAGE_PREFIX.NO_MODEL_FOUND}: nessun modello trovato, con le stesse attività, per l'articolo ${articoloDaConfigurare.prodotto}`);
            // Chiudi la finestra con l'elenco dei modelli disponibili
            await articoliPrisPage.click("#id_pris_articoli_modprod_modal > div > div > div.modal-footer > button.btn.btn-white");
            // Chiudi la finestra "Configura Modello" (nuovo modello)
            await articoliPrisPage.click("#id_pris_articoli_configForm > div.modal-footer > button.btn.btn-white");
        }
        catch (e) {
            console.error(e);
        }
    }
}

(async function main() {
    applyLogLevel();

    const articoliDaConfigurare: Map<string, ArticoloDaConfigurare> = getArticoliDaConfigurare();

    console.info("Articoli da fare:", articoliDaConfigurare);

    const browser = await chromium.launch({
        headless: false,
    });

    const context: BrowserContext = await browser.newContext();
    const loginPage: Page = await context.newPage();

    // Override di "auto accept" sui dialog.
    // Il web scraper utilizza degli alert per comunicare con l'utente.
    loginPage.on("dialog", () => {});

    do {
        await loginPage.goto(SM2CARE_LOGIN_PAGE_URL);
        await loginPage.waitForLoadState("networkidle");

        await loginPage.fill("#id_sm_utenti_username", SM2CARE_USERNAME);
        await loginPage.fill("#id_sm_utenti_password", SM2CARE_PASSWORD);
        await loginPage.click("#id_loginForm > div.login-buttons > button");

        await loginPage.waitForURL(new RegExp(SM2CARE_HOMEPAGE_URL), { timeout: 5000 });
    }
    while (!loginPage.url().match(SM2CARE_HOMEPAGE_URL));

    const homepage = loginPage;

    await homepage.click("#id_li_beemo > a");
    await homepage.click("#id_li_beemo_pris > a");
    await homepage.click("#id_li_beemo_pris_articoli > a");

    const articoliPrisPage = homepage;
    const articoliConfigurati: Map<string, ArticoloConfigurato> = new Map();
    for (const [, articoloDaConfigurare] of articoliDaConfigurare) {
        await articoliPrisPage.fill("#id_table_famiglie_filter > label > input", `${articoloDaConfigurare.famiglia} ${articoloDaConfigurare.prodotto}`);
        await articoliPrisPage.click("#id_table_famiglie > tbody > tr:nth-child(1)");
        await articoliPrisPage.fill("#id_table_pris_articoli_filter > label > input", articoloDaConfigurare.prodotto);

        let configurazioniPerArticolo: number = await countRowsInTBody(
            articoliPrisPage.locator("#id_table_pris_articoli > tbody > tr"),
            articoliPrisPage
        );

        console.info(`Configurazioni trovate per [${articoloDaConfigurare.famiglia}, ${articoloDaConfigurare.prodotto}]: ${configurazioniPerArticolo}`);

        if (configurazioniPerArticolo === 0) {
            console.error(`${LOG_MESSAGE_PREFIX.NO_BEEMO_CONFIG_FOUND}: nessuna configurazione trovata per l'articolo ${articoloDaConfigurare.prodotto}`);
        }
        else {
            let save: boolean = true;
            for (let nth = 1; nth <= configurazioniPerArticolo; nth++) {
                const articoloConfigurato: ArticoloConfigurato | undefined =
                    await handleConfigurazionePerArticolo(articoloDaConfigurare, articoliPrisPage, nth);

                if (articoloConfigurato) {
                    console.info(`${LOG_MESSAGE_PREFIX.PRODUCT_CONFIGURED_SUCCESSFULLY}:\t${articoloConfigurato.prodotto}\t${articoloConfigurato.famiglia}\t${articoloConfigurato.priorita}`);
                    articoliConfigurati.set(`${articoloConfigurato.famiglia}${articoloConfigurato.prodotto}`, articoloConfigurato);
                }
                else {
                    save = false;
                }
            }
            saveArticoliDaConfigurare(articoliDaConfigurare, articoliConfigurati);
        }
    }

    // await browser.close();
})();
