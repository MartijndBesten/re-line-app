import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateScenarios, internalScenarioPack } from "../lib/proposal";
test("Drie scenario's zijn zonder prijsbron en inspectie niet vergelijkbaar", () => {
 const r=evaluateScenarios([]);
 assert.equal(r.length,3);
 assert.ok(r.every(x=>!x.complete && x.total===null));
 const pack=internalScenarioPack("Testlocatie",r);
 assert.match(pack,/Geen betrouwbare totaalprijs/);
 assert.doesNotMatch(pack,/€\s?\d+/);
});
test("Alleen volledig en bevestigd scenario toont totaal", () => {
 const values={meters:100,modules:50,material:1000,installation:200,commissioning:100,other:0,technicalConfirmed:true,technicalBy:"Testcontroleur",priceSource:"Interne testbron",priceDate:"2026-10-01",notes:"Fictieve test"};
 const r=evaluateScenarios([
  {kind:"Retrofit",data:JSON.stringify(values)},
  {kind:"Complete vervanging",data:JSON.stringify({...values,technicalConfirmed:false})},
  {kind:"Slimme verlichting",data:"{broken"},
 ]);
 assert.equal(r[0].complete,true);
 assert.equal(r[0].total,1300);
 assert.equal(r[1].complete,false);
 assert.equal(r[1].total,null);
 assert.equal(r[2].complete,false);
 assert.match(internalScenarioPack("Testgebouw",r),/1\.300,00/);
});
