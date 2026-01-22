import * as fs from "fs";
import path from "node:path";

type CsvRecord = {
    articolo: string,
    modello: string,
    priorita: string,
    attivita: string,
    operazione: string,
};

const THIP_MODPRO_PATH: string = path.join("..", "static", "thip_modpro.csv");
const SPM_PRIS_ARTICOLI_PATH: string = path.join( "..", "static", "spm_pris_articoli_modprod.csv");


(async function main() {
    const spmPrisArticoliLines: string[] = fs.readFileSync(SPM_PRIS_ARTICOLI_PATH, "utf-8").split("\n");
    let thipModproLines: string[] = fs.readFileSync(THIP_MODPRO_PATH, "utf-8").split("\n");

    const sameConfigurations: CsvRecord[] = [];

    let PA_idx: number = 0;
    let notMatching: CsvRecord[] = [];
    for await (const spmPrisArticoliLine of spmPrisArticoliLines) {
        if (PA_idx++ === 0) continue;

        const [ PA_modello, PA_priorita, PA_articolo, PA_attivita, PA_operazione ] = spmPrisArticoliLine.split(",");

        let TM_idx: number = 0;
        for await (const thipModproLine of thipModproLines) {
            if (TM_idx++ === 0) continue;

            const [ TM_modello, TM_priorita, TM_articolo, TM_attivita, TM_operazione ] = thipModproLine.split(",");

            if (
                PA_articolo === TM_articolo &&
                PA_attivita === TM_attivita &&
                PA_operazione === TM_operazione
            ) {
                sameConfigurations.push({
                    modello: TM_modello,
                    priorita: TM_priorita,
                    articolo: TM_articolo,
                    attivita: TM_attivita,
                    operazione: TM_operazione,
                });
                break;
            }
        }

        if (TM_idx === thipModproLines.length) {
            notMatching.push({
                modello: PA_modello,
                priorita: PA_priorita,
                articolo: PA_articolo,
                attivita: PA_attivita,
                operazione: PA_operazione,
            });
        }
    }

    fs.writeFileSync(path.join("..", "static", "same-configurations.csv"),
        sameConfigurations.map(r => Object.values(r).join(",")).join("\n")
    );

    console.log("Not matching:", notMatching);
    console.log("Total records:", spmPrisArticoliLines.length - 1);
    console.log("Not matching records:", notMatching.length);
    console.log("Same configurations:", sameConfigurations.length);
})();

