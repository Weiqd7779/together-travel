import test from "node:test";
import assert from "node:assert/strict";

const origin = process.env.TRIP_TEST_URL || "http://127.0.0.1:5173";
function visitor() {
    let cookie = "";
    return {
        async post(action, input = {}) {
            const response = await fetch(`${origin}/api/rooms`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ action, ...input }) });
            const updated = response.headers.get("set-cookie");
            if (updated) cookie = updated.split(";")[0];
            return { status: response.status, data: await response.json() };
        },
        async get(roomId) {
            const response = await fetch(`${origin}/api/rooms?room=${roomId}`, { headers: { Cookie: cookie } });
            return { status: response.status, data: await response.json() };
        },
    };
}
test("two travelers share chat, independent movement, and early meeting arrivals", async () => {
    const a = visitor(), b = visitor(), stranger = visitor();
    const created = await a.post("create", { name: "測試旅人 A", avatar: 0 });
    assert.equal(created.status, 200, JSON.stringify(created.data));
    const roomId = created.data.id;
    const joined = await b.post("join", { roomId, name: "測試旅人 B", avatar: 1 });
    assert.equal(joined.status, 200);
    assert.notEqual(joined.data.selfId, created.data.selfId);
    assert.equal((await a.get(roomId)).data.members.length, 2);
    assert.equal((await stranger.get(roomId)).status, 401);
    assert.equal((await b.post("gather", { roomId, meeting: "redhouse" })).status, 403);
    assert.equal((await b.post("depart", { roomId, destination: "unknown" })).status, 400);
    assert.equal((await b.post("start", { roomId, meeting: "redhouse" })).status, 403);
    assert.equal((await b.post("depart", { roomId, destination: "redhouse" })).status, 409);
    assert.equal((await a.post("start", { roomId, meeting: "redhouse" })).status, 200);
    assert.equal((await b.get(roomId)).data.started, true);
    assert.equal((await a.post("chat", { roomId, kind: "text", content: "集合前一起聊聊天" })).status, 200);
    assert.equal((await b.get(roomId)).data.messages.at(-1).content, "集合前一起聊聊天");
    assert.equal((await b.post("chat", { roomId, kind: "sticker", content: "🐧" })).status, 200);
    assert.equal((await a.get(roomId)).data.messages.at(-1).kind, "sticker");
    assert.equal((await b.post("chat", { roomId, kind: "sticker", content: "invalid" })).status, 400);
    await b.post("depart", { roomId, destination: "redhouse" });
    let shared = (await a.get(roomId)).data;
    assert.equal(shared.members.find((member) => member.id === joined.data.selfId).status, "walking");
    assert.equal(shared.members.find((member) => member.id === created.data.selfId).destination, "lobby");
    await a.post("gather", { roomId, meeting: "redhouse" });
    await b.post("arrive", { roomId });
    shared = (await a.get(roomId)).data;
    assert.equal(shared.meeting, "redhouse");
    assert.equal(shared.members.filter((member) => member.destination === shared.meeting && member.status !== "walking").length, 1);
    await a.post("depart", { roomId, destination: "redhouse", memberId: joined.data.selfId });
    await a.post("arrive", { roomId });
    shared = (await b.get(roomId)).data;
    assert.equal(shared.members.filter((member) => member.destination === shared.meeting && member.status === "arrived").length, 2);
    assert.equal((await stranger.post("create", { name: "另一段旅程", avatar: 3 })).status, 200);
    assert.equal((await stranger.get(roomId)).status, 401);
    assert.equal((await a.post("chat", { roomId, kind: "text", content: "x".repeat(201) })).status, 400);
});
