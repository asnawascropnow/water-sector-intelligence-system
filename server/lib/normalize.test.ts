import { test } from "node:test";
import assert from "node:assert/strict";
import { extractArea, normalizeName, normalizePhone, normalizeWebsite } from "./normalize";
import { similarity } from "./duplicates";

test("normalizeName treats legal-suffix and plural variants as equal", () => {
  assert.equal(normalizeName("ABC Industries Pvt Ltd"), normalizeName("ABC Industry Private Limited"));
  assert.equal(normalizeName("Infosys Technologies Ltd."), normalizeName("Infosys Technology"));
  assert.notEqual(normalizeName("ABC Industries"), normalizeName("XYZ Industries"));
});

test("normalizePhone distinguishes Bengaluru landlines from mobiles", () => {
  assert.equal(normalizePhone("080 2839 1234"), "+91 80 2839 1234");
  assert.equal(normalizePhone("28391234"), "+91 80 2839 1234");
  assert.equal(normalizePhone("9845012345"), "+91 98450 12345");
  assert.equal(normalizePhone("+91 8012345678"), "+91 80123 45678");
});

test("normalizeWebsite / extractArea", () => {
  assert.equal(normalizeWebsite("WWW.Example.com/"), "https://www.example.com");
  assert.equal(normalizeWebsite("not a site"), null);
  assert.equal(extractArea("Plot 4, Electronic City Phase 1, Bengaluru"), "Electronic City");
  assert.equal(extractArea("RR Nagar, Bangalore"), "Rajarajeshwari Nagar");
});

test("similarity", () => {
  assert.equal(similarity("abc", "abc"), 1);
  assert.ok(similarity("indian institute of science", "indian institute of science iisc") > 0.8);
  assert.ok(similarity("apollo hospital", "fortis hospital") < 0.7);
});
