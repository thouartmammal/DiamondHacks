/**
 * Build user-facing family match copy from a loved-one record (face match result).
 * Matching is done elsewhere (faces); we do not match on names here.
 */

function relationshipPhrase(p) {
  const rel = (p.relationship || "").trim();
  const custom = (p.customRelationship || "").trim();
  if (custom) {
    if (/\bsister\b/i.test(custom)) return "sister";
    if (/\bbrother\b/i.test(custom)) return "brother";
  }
  if (rel === "Other" && custom) {
    return custom.toLowerCase();
  }
  const map = {
    Mom: "mom",
    Dad: "dad",
    Sibling: "sibling",
    Spouse: "spouse",
    Child: "child",
    Grandchild: "grandchild",
  };
  return map[rel] || (rel ? rel.toLowerCase() : "family member");
}

/**
 * @param {{ name?: string, relationship?: string, customRelationship?: string }} person
 */
export function buildFamilyMatchDisplay(person) {
  const phrase = relationshipPhrase(person);
  const nm = String(person.name || "").trim() || "them";
  return {
    name: nm,
    relationshipPhrase: phrase,
    headline: `This is your ${phrase}`,
    message: `This is your ${phrase}, ${nm}.`,
  };
}
