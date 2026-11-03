import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeInternalBrief, verifiedFacts, portfolioProjects, rankedRelations,
  type BriefProject,
} from "../lib/commercial";

function dossier(): BriefProject {
  return {
    id:"p1", name:"Testmagazijn", city:"Teststad", firstYear:2014, lastYear:2016,
    meters:null, status:"Nieuw gevonden", present:"Onbekend", replaced:"Onbekend",
    need:"Onbekend", location_confirmed:0, debtors:"Groothandel X",
    lines: [
      {document:"900001",position:"10",article:"TEST-1",quantity:120,order_date:"2014-04-02",description:"Testprofiel"},
      {document:"900002",position:"20",article:"TEST-2",quantity:60,order_date:"2016-08-01"},
    ],
  };
}
test("Intern dossier maakt geen leverings-, lengte- of prijsclaims", () => {
  const d = dossier(), text=makeInternalBrief(d);
  assert.match(text, /Testmagazijn/);
  assert.match(text, /900001\/10/);
  assert.match(text, /Historische stuks in dataset: 180/);
  assert.match(text, /Bevestigde profielmeters: Onbekend/);
  assert.match(text, /geen bevestigde installatie/i);
  assert.doesNotMatch(text, /€\s?\d+/);
  assert.match(text, /Geen.*levering|niet bewezen geleverd/i);
});
test("Gecontroleerde locatie staat apart van historische naam", () => {
  const d=dossier();
  assert.equal(verifiedFacts(d).find(f=>f.label==="Gecontroleerde installatielocatie")?.value,"Nog niet bevestigd");
  d.location_confirmed=1; d.address="Teststraat 12";
  assert.equal(verifiedFacts(d).find(f=>f.label==="Gecontroleerde installatielocatie")?.value,"Teststraat 12");
});
test("Relationele portefeuille telt unieke project-ID en behandelt rollen onafhankelijk", () => {
  const links=[
    {relationId:"r1",projectId:"p1"},{relationId:"r1",projectId:"p1"},
    {relationId:"r2",projectId:"p1"},{relationId:"r1",projectId:"p2"},
  ];
  const projects=[
    {id:"p1",name:"Locatie 1",quantity:10},{id:"p2",name:"Locatie 2",quantity:30},
  ];
  assert.deepEqual(portfolioProjects("r1",links,projects).map(p=>p.id),["p2","p1"]);
  assert.equal(portfolioProjects("r2",links,projects).length,1);
  assert.deepEqual(rankedRelations([
    {id:"a",name:"Debiteur A",role:"Debiteur",projectCount:8},
    {id:"b",name:"Installateur B",role:"Installateur",projectCount:3},
  ],"Installateur").map(r=>r.id),["b"]);
});
