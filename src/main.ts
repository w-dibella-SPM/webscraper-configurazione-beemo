import { BrowserContext, chromium, FrameLocator, Locator, Page } from "playwright";
import * as fs from "node:fs";
import dotenv from "dotenv";

type LogLevel = "log" | "info" | "warn" | "error";

type ArticoloDaFare = {
    famiglia: string,
    prodotto: string,
};

type ArticoloConfigurato = ArticoloDaFare & {
    priorita: string,
};

dotenv.config({
    path: "../.env",
});

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

function getArticoliDaFare(): ArticoloDaFare[] {
    return fs
        .readFileSync("../static/pris_articoli_da_fare.csv", "utf-8")
        .split("\n")
        // Skip header line
        .slice(1)
        .map(l => {
            const [ famiglia, prodotto ] = l.split(",");
            return { famiglia, prodotto };
        });
}

async function countRowsInTBody(trLocator: Locator, page: Page): Promise<number> {
    let prevCount: number = -1;
    let count: number = await trLocator.count();

    while (prevCount !== count) {
        prevCount = count;
        await page.waitForTimeout(100);
        count = await trLocator.count();
    }
    return count;
}

async function handleConfigurazionePerArticolo(articoloDaFare: ArticoloDaFare, articoliPrisPage: Page, nth: number): Promise<ArticoloConfigurato | undefined> {
    type OptionalValue<T> = { present: true, value: T } | { present: false };

    type Attivita = {
        codice: string;
        operazione: string;
        ok: OptionalValue<boolean>,
        ko: OptionalValue<boolean>,
        costoAttivita: OptionalValue<number>;
    };

    const prioritaCellInnerText: string =
        await articoliPrisPage.locator(`#id_table_pris_articoli > tbody > tr:nth-child(${nth}) > td:nth-child(4)`).innerText();

    if (prioritaCellInnerText === "J") {
        try {
            // Click su modifica
            await articoliPrisPage.click(`#id_table_pris_articoli > tbody > tr:nth-child(${nth}) > td.text-right.all.avoid-selection > a.btn.btn-blue`);

            // Controlla che attività ci sono per il modello con priorità J

            // Mostra 100 attività
            await articoliPrisPage.selectOption("#id_table_pris_articoli_modprod_length > label > select", "100");

            const attivitaModelloRowLocator: Locator = articoliPrisPage.locator("#id_table_pris_articoli_modprod > tbody > tr");
            const attivitaModelloCount: number = await countRowsInTBody(attivitaModelloRowLocator, articoliPrisPage);

            if (attivitaModelloCount === 0 || await attivitaModelloRowLocator.nth(0).locator("td:nth-child(1)").getAttribute("class") === "dataTables_empty") {
                throw "Modello con priorità J senza attività";
            }

            const elencoAttivitaModelloPrioritaJ: Attivita[] = [];
            for (let i = 0, nth = 1; i < attivitaModelloCount; i++, nth++) {
                const [ okThumbLocator, koThumbLocator, costoLocator ]: [ Locator, Locator, Locator ] = [
                    attivitaModelloRowLocator.nth(i).locator("td:nth-child(7) > a > i"),
                    attivitaModelloRowLocator.nth(i).locator("td:nth-child(8) > a > i"),
                    attivitaModelloRowLocator.nth(i).locator("td:nth-child(9) > div > div > input"),
                ];

                const [ operazione, codice, ok, ko, costoAttivita ]: [
                    string, string, OptionalValue<boolean>, OptionalValue<boolean>, OptionalValue<number>
                ] = [
                    await attivitaModelloRowLocator.nth(i).locator("td:nth-child(3)").innerText(),
                    await attivitaModelloRowLocator.nth(i).locator("td:nth-child(4)").innerText(),
                    await (async (): Promise<OptionalValue<boolean>> => {
                        if (await okThumbLocator.count() > 0) {
                            return {
                                present: true,
                                value: !!(await okThumbLocator.getAttribute("class"))?.includes("thumb-up"),
                            };
                        }
                        return { present: false };
                    })(),
                    await (async (): Promise<OptionalValue<boolean>> => {
                        if (await koThumbLocator.count() > 0) {
                            return {
                                present: true,
                                value: !!(await koThumbLocator.getAttribute("class"))?.includes("thumb-up"),
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

                elencoAttivitaModelloPrioritaJ.push({ operazione, codice, ok, ko, costoAttivita });
                console.log(elencoAttivitaModelloPrioritaJ);
            }

            // Chiudi la finestra di modifica
            await articoliPrisPage.click("#id_pris_articoli_configForm > div.modal-footer > button.btn.btn-white");

            // Controlla i modelli disponibili

            // Clicca su "+"
            await articoliPrisPage.click("#id_pris_articoli_nuovo");

            // Clicca sulla combobox
            await articoliPrisPage.click("#id_pris_articoli_configForm > div.modal-body > div:nth-child(1) > div > span");
            // Cerca i modelli disponibili per l'articolo da fare
            await articoliPrisPage.fill("body > span > span > span.select2-search.select2-search--dropdown > input", articoloDaFare.prodotto);

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

                const attivitaModelloPanthRowLocator: Locator = articoliPrisPage.locator("#id_table_panth_modprod_d > tbody");
                const attivitaModelloPanthCount: number = await countRowsInTBody(attivitaModelloPanthRowLocator, articoliPrisPage);

                // Se il numero di attività non coincide, vai al modello successivo
                if (attivitaModelloPanthCount !== elencoAttivitaModelloPrioritaJ.length) continue;

                for (let j = 0; j < attivitaModelloPanthCount; j++) {
                    const [ operazione, codice ]: [ string, string ] = [
                        await attivitaModelloPanthRowLocator.nth(j).locator("td:nth-child(1)").innerText(),
                        await attivitaModelloPanthRowLocator.nth(j).locator("td:nth-child(2)").innerText(),
                    ];

                    // Se una delle attività non coincide, vai al modello successivo
                    if (
                        operazione !== elencoAttivitaModelloPrioritaJ[j].operazione ||
                        codice !== elencoAttivitaModelloPrioritaJ[j].codice
                    ) break;
                }

                // Se tutte le attività coincidono, seleziona il modello
                await articoliPrisPage.click("#id_table_panth_modprod > tbody > tr > td.text-left.all.dtr-control > a");

                // Importa il modello
                await articoliPrisPage.evaluate(() => {
                    alert("TROVATA CONFIGURAZIONE CHE COINCIDE!!!");
                })
                await articoliPrisPage.click("#id_pris_articoli_modprod_modal_importa");

                // TODO implement
            }

            // TODO implement

            // Fallback se le configurazioni trovate non vanno bene
            await articoliPrisPage.evaluate(() => alert("Seleziona una configurazione da applicare..."))
        }
        catch (e) {
            console.error(e);
            return undefined;
        }
        finally {
            await articoliPrisPage.click("#id_pris_articoli_configForm > div.modal-footer > button.btn.btn-white");
        }
    }
    else {
        console.info(`SKIP: priorità diversa da J per l'articolo ${articoloDaFare.prodotto} (priorità: ${prioritaCellInnerText}).`);
    }

    // TODO remove
    return undefined;
}

(async function main() {
    applyLogLevel();

    const articoliDaFare: ArticoloDaFare[] = getArticoliDaFare();
    const articoliDaFareCount: number = articoliDaFare.length;

    console.info("Articoli da fare:", articoliDaFare);

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

    const articoliFatti: ArticoloDaFare[] = [];
    for (const articoloDaFare of articoliDaFare) {
        await articoliPrisPage.fill("#id_table_famiglie_filter > label > input", articoloDaFare.famiglia);
        await articoliPrisPage.click("#id_table_famiglie > tbody > tr:nth-child(1)");
        await articoliPrisPage.fill("#id_table_pris_articoli_filter > label > input", articoloDaFare.prodotto);

        let configurazioniPerArticolo: number = await countRowsInTBody(
            articoliPrisPage.locator("#id_table_pris_articoli > tbody > tr"),
            articoliPrisPage
        );

        console.info(`Configurazioni trovate per l'articolo ${articoloDaFare.prodotto}: ${configurazioniPerArticolo}`);

        if (configurazioniPerArticolo === 0) {
            console.error(`Nessuna configurazione trovata per l'articolo ${articoloDaFare.prodotto}`);
        }
        else {
            for (let nth = 1; nth <= configurazioniPerArticolo; nth++) {
                await handleConfigurazionePerArticolo(articoloDaFare, articoliPrisPage, nth);
            }
        }

    }

    // await browser.close();
})();
