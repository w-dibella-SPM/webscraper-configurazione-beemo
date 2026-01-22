import { BrowserContext, chromium, FrameLocator, Locator, Page } from "playwright";
import * as fs from "node:fs";

const USERNAME = "w.dibella";
const PASSWORD = "WillyDibe24@";
const SM2CARE_BASE_URL = "http://172.23.0.111/";
const SM2CARE_LOGIN_PAGE_URL = `${SM2CARE_BASE_URL}login.php`;
const SM2CARE_HOMEPAGE_URL = `${SM2CARE_BASE_URL}index.php`;

type ArticoloDaFare = {
    famiglia: string,
    prodotto: string,
};

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

(async function main() {
    const articoliDaFare: ArticoloDaFare[] = getArticoliDaFare();
    const articoliDaFareCount: number = articoliDaFare.length;

    console.log("Articoli da fare:", articoliDaFare);

    const browser = await chromium.launch({
        headless: false,
    });

    const context: BrowserContext = await browser.newContext();
    const loginPage: Page = await context.newPage();

    do {
        await loginPage.goto(SM2CARE_LOGIN_PAGE_URL);
        await loginPage.waitForLoadState("networkidle");

        await loginPage.fill("#id_sm_utenti_username", USERNAME);
        await loginPage.fill("#id_sm_utenti_password", PASSWORD);
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
    while (articoliDaFare.length) {
        const articoloDaFare = articoliDaFare.pop()!;

        await articoliPrisPage.fill("#id_table_famiglie_filter > label > input", articoloDaFare.famiglia);
        await articoliPrisPage.click("#id_table_famiglie > tbody > tr:nth-child(1)");
        await articoliPrisPage.fill("#id_table_pris_articoli_filter > label > input", articoloDaFare.prodotto);

        const prisArticoliRowsLocator: Locator = articoliPrisPage.locator("#id_table_pris_articoli > tbody > tr");
        await prisArticoliRowsLocator.last().waitFor();
        // TODO sistema (non funziona)
        const configurazioniPerArticolo: number = await prisArticoliRowsLocator.count();

        if (configurazioniPerArticolo === 0) {
            console.log(`Nessuna configurazione trovata per l'articolo ${articoloDaFare.prodotto}`);
        }
        else if (configurazioniPerArticolo > 1) {
            console.log(`Più di una configurazione trovata per l'articolo ${articoloDaFare.prodotto}`);
        }
        else {
            // const modificaBtnLocator = (nth: number = 1): Locator =>
            //     articoliPrisPage.locator(`#id_table_pris_articoli > tbody > tr:nth-child(${nth}) > td.text-right.all.avoid-selection > a.btn.btn-blue`);

            const prioritaCellInnerText: string =
                await articoliPrisPage.locator("#id_table_pris_articoli > tbody > tr:nth-child(1) > td:nth-child(4)").innerText();

            if (prioritaCellInnerText === "J") {
                await articoliPrisPage.click("#id_table_pris_articoli > tbody > tr > td.text-right.all.avoid-selection > a.btn.btn-blue");
                await articoliPrisPage.selectOption("#id_table_pris_articoli_modprod_length > label > select", "100");

                break;
                articoliFatti.push(articoloDaFare);
            }
            else {
                console.log(`Priorità diversa da J per l'articolo ${articoloDaFare.prodotto}. Priorità: ${prioritaCellInnerText}`);
            }
        }

    }

    // await browser.close();
})();
