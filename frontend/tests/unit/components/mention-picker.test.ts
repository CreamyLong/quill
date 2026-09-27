import { expect, test } from "@rstest/core";

import { getAtMentionQuery } from "@/components/workspace/mention-picker";

test("detects a trailing @-mention fragment at the caret", () => {
  expect(getAtMentionQuery("hello @res", 11)).toBe("res");
  expect(getAtMentionQuery("@", 1)).toBe("");
  expect(getAtMentionQuery("hi @writer-", 11)).toBe("writer-");
});

test("returns null when the @ starts a word mid-text without a preceding space", () => {
  expect(getAtMentionQuery("email me a@b", 13)).toBeNull();
});

test("returns null when the fragment contains whitespace", () => {
  expect(getAtMentionQuery("hello @res earch", 17)).toBeNull();
});

test("uses the caret, not the end of the value", () => {
  // "hello @research team": caret at index 9 sits right after "@re".
  expect(getAtMentionQuery("hello @research team", 9)).toBe("re");
  // Caret at 15 sits right after "@research" (the fragment is still active).
  expect(getAtMentionQuery("hello @research team", 15)).toBe("research");
  // Caret after the space → no active fragment.
  expect(getAtMentionQuery("hello @research team", 16)).toBeNull();
});
