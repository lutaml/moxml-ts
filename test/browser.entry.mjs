// The browser-side acceptance harness: the same expectations as
// test/acceptance.test.ts, driven by headless Chrome against the
// vendored bundles served over HTTP. Results land on window.__RESULTS
// for the driver script to collect.
const results = [];
const run = async (name, fn) => {
  try {
    await fn();
    results.push([name, true, null]);
  } catch (e) {
    results.push([name, false, String(e && e.message ? e.message : e)]);
  }
};
const assert = (ok, msg) => {
  if (!ok) throw new Error(msg || "assertion failed");
};
const eq = (got, want, msg) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) throw new Error(`${msg || "eq"}: got ${g}, want ${w}`);
};

const { initEngine, parse, createDocument, initModel, RegistryFace, valid_lexical, WildcardFace } = await import("/dist/index.js");

await run("engine: init + parse + serialize", async () => {
  await initEngine();
  const doc = await parse('<person name="Alice"><age>30</age></person>');
  eq(doc.rootName(), "person", "rootName");
  const xml = doc.toXml();
  assert(xml.includes("Alice") && xml.includes("30"), "round-trip");
});

await run("engine: namespaces + CDATA + comments + PIs survive", async () => {
  const doc = await parse('<root xmlns:ns="http://example.com"><ns:child>data</ns:child></root>');
  assert(doc.toXml().includes("ns:child"), "ns child");
  const c = await parse("<root><![CDATA[<script>alert('x')</script>]]></root>");
  assert(c.toXml().includes("<script>"), "cdata");
  const p = await parse('<?xml version="1.0"?><?pi-target pi-data?><root/>');
  assert(p.toXml().includes("pi-target"), "pi");
});

await run("engine: node handles + builder + typed xpath", async () => {
  const doc = await parse("<root><child>text</child></root>");
  const root = doc.root();
  eq(root.name(), "root", "root name");
  eq(root.children()[0].name(), "child", "child name");

  const built = await createDocument();
  const r = built.createElement("root");
  r.setAttribute("attr", "value");
  r.addChild(built.createText("hello"));
  built.setRoot(r);
  assert(built.toXml().includes('attr="value"'), "builder attr");

  const typed = doc.xpathTyped("/root/child");
  eq(typed.kind(), 0, "nodeset kind");
  eq(typed.nodes()[0].text(), "text", "nodeset text");
  eq(doc.xpathTyped("count(/root/child)").kind(), 2, "number kind");
  eq(doc.xpathTyped("count(/root/child)").number(), 1, "count value");
});

await run("engine: xsd validate both directions", async () => {
  const { compileXsd } = await import("/dist/index.js");
  const schema = await compileXsd(
    '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="r"><xs:complexType><xs:sequence><xs:element name="a" type="xs:string" maxOccurs="unbounded"/></xs:sequence></xs:complexType></xs:element></xs:schema>',
  );
  eq(schema.validate(await parse("<r><a/></r>")).valid, true, "valid instance");
  const bad = schema.validate(await parse("<r><b/></r>"));
  eq(bad.valid, false, "invalid instance");
  assert(bad.errors.length > 0, "error rows");
});

await run("model: lexical + wildcard + entity faces", async () => {
  await initModel();
  eq(valid_lexical("xs:int", "42"), true, "lexical int");
  const w = new WildcardFace("##other", "strict", null, []);
  eq(w.covers("local"), false, "other excludes local");
  eq(w.covers("urn:x"), true, "other admits foreign");
  const reg = new RegistryFace(["nbsp"], [" "]);
  eq(reg.codepoint_for_name("nbsp"), 160, "nbsp codepoint");
  eq(reg.primary_name_for_codepoint(160), "nbsp", "primary");
});

window.__RESULTS = results;
document.title = "moxml-ts-browser-done";
