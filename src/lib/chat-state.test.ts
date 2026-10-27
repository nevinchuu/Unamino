import { describe, expect, it } from "vitest";
import { lastSeq, mergeMessages, visiblePending, type PendingMessage, type SeqMessage } from "./chat-state";

const m = (seq: number, overrides: Partial<SeqMessage> = {}): SeqMessage => ({ id: `m-${seq}`, seq, senderId: "ana", body: `message ${seq}`, ...overrides });

describe("mergeMessages", () => {
  it("keeps messages oldest first, whatever order they arrive in", () => {
    expect(mergeMessages([m(1), m(4)], [m(3), m(2)]).map((x) => x.seq)).toEqual([1, 2, 3, 4]);
  });

  it("keeps a message that arrives twice once, preferring the newer copy", () => {
    const merged = mergeMessages([m(1)], [m(1, { body: "edited by the server" })]);
    expect(merged).toHaveLength(1);
    expect(merged[0].body).toBe("edited by the server");
  });

  it("changes nothing for an empty poll, and does not touch what it was given", () => {
    const existing = [m(2), m(1)];
    expect(mergeMessages(existing, []).map((x) => x.seq)).toEqual([1, 2]);
    expect(existing.map((x) => x.seq)).toEqual([2, 1]);
  });

  it("starts a chat from nothing", () => {
    expect(mergeMessages([], [m(5), m(6)]).map((x) => x.seq)).toEqual([5, 6]);
  });
});

describe("visiblePending", () => {
  const sending = (overrides: Partial<PendingMessage> = {}): PendingMessage => ({ tempId: "t1", body: "hello", replyToId: null, status: "sending", sentAt: 0, afterSeq: 10, ...overrides });

  it("shows a message that has not arrived yet", () => {
    expect(visiblePending([sending()], [m(10)], "ana")).toHaveLength(1);
  });

  it("hides it as soon as the real message is in the chat", () => {
    expect(visiblePending([sending()], [m(10), m(11, { body: "hello" })], "ana")).toHaveLength(0);
  });

  it("does not mistake someone else's identical words, or an older message of the same words, for it", () => {
    expect(visiblePending([sending()], [m(11, { body: "hello", senderId: "ben" })], "ana")).toHaveLength(1);
    expect(visiblePending([sending()], [m(9, { body: "hello" })], "ana")).toHaveLength(1);
  });

  it("always keeps a message that failed, so the person can try again", () => {
    expect(visiblePending([sending({ status: "failed" })], [m(11, { body: "hello" })], "ana")).toHaveLength(1);
  });

  it("handles several at once", () => {
    const pending = [sending({ tempId: "a", body: "one" }), sending({ tempId: "b", body: "two" })];
    expect(visiblePending(pending, [m(11, { body: "one" })], "ana").map((p) => p.tempId)).toEqual(["b"]);
  });
});

describe("lastSeq", () => {
  it("is the newest message's number, or 0 for an empty chat", () => {
    expect(lastSeq([m(3), m(7)])).toBe(7);
    expect(lastSeq([])).toBe(0);
  });
});
