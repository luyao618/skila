import { describe, it, expect } from "vitest";
import { parseSkillFile, serializeSkillFile } from "../../src/inventory/frontmatter.js";
import jsyaml from "js-yaml";

describe("FIX-H11: Frontmatter parser", () => {
  it("parses flow sequences [a, b, c]", () => {
    const raw = `---
name: my-skill
tags: [alpha, beta, gamma]
---
body
`;
    const { frontmatter } = parseSkillFile(raw);
    expect((frontmatter as any).tags).toEqual(["alpha", "beta", "gamma"]);
  });

  it("parses block scalar description with | indicator", () => {
    const raw = `---
name: my-skill
description: |
  This is line one.
  This is line two.
version: 1.0.0
---
body
`;
    const { frontmatter } = parseSkillFile(raw);
    expect((frontmatter as any).description).toContain("This is line one.");
    expect((frontmatter as any).description).toContain("This is line two.");
  });

  it("always reads version as string even when numeric-looking", () => {
    const raw = `---
name: my-skill
version: 1.0
---
body
`;
    const { frontmatter } = parseSkillFile(raw);
    expect(typeof (frontmatter as any).version).toBe("string");
    expect((frontmatter as any).version).toBe("1.0");
  });

  it("reads integer-looking version as string", () => {
    const raw = `---
name: my-skill
version: 2
---
body
`;
    const { frontmatter } = parseSkillFile(raw);
    expect(typeof (frontmatter as any).version).toBe("string");
    expect((frontmatter as any).version).toBe("2");
  });
});

describe("FIX-H10: Frontmatter serializer round-trip", () => {
  const CHARS = "abcdefghijklmnopqrstuvwxyz0123456789-._";
  function randName(seed: number): string {
    // simple deterministic pseudo-random name using seed
    const len = 3 + (seed % 8);
    let s = "";
    for (let i = 0; i < len; i++) {
      s += CHARS[(seed * 31 + i * 17) % CHARS.length];
    }
    // ensure first char is alphanumeric
    if (!/^[a-z0-9]/.test(s)) s = "a" + s.slice(1);
    return s;
  }

  it("round-trips 200 random frontmatters via serialize→js-yaml.load", () => {
    const statuses = ["draft", "staging", "published", "archived", "disabled"] as const;
    for (let seed = 0; seed < 200; seed++) {
      const name = randName(seed);
      const version = `${(seed % 5) + 1}.${seed % 10}.${seed % 3}`;
      const status = statuses[seed % statuses.length];
      const description = seed % 3 === 0 ? `description with special: chars & more ${seed}` : `simple description ${seed}`;
      const frontmatter = { name, version, status, description } as any;
      const serialized = serializeSkillFile(frontmatter, "body");
      // extract yaml section between --- markers
      const yamlSection = serialized.slice(4, serialized.indexOf("\n---", 4));
      const parsed = jsyaml.load(yamlSection) as any;
      expect(parsed.name).toBe(name);
      expect(parsed.version).toBe(version);
      expect(parsed.status).toBe(status);
      expect(parsed.description).toBe(description);
    }
  });

  it("existing fixtures still parse: basic frontmatter", () => {
    const raw = `---
name: my-skill
version: 1.0.0
status: draft
---
body here
`;
    const { frontmatter, body } = parseSkillFile(raw);
    expect((frontmatter as any).name).toBe("my-skill");
    expect((frontmatter as any).version).toBe("1.0.0");
    expect(body.trim()).toBe("body here");
  });
});
