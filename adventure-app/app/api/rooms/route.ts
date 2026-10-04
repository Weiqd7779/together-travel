import { TripError, readRoom, roomDatabase, sessionHash } from "../../../lib/room-store";
import { isPlaceId, stickers } from "../../../lib/travel";

const tokenFromRequest = (request: Request) => request.headers.get("cookie")?.match(/(?:^|;\s*)ximen_session=([a-f0-9]{32})(?:;|$)/)?.[1];
const validId = (id: unknown): id is string => typeof id === "string" && /^[a-f0-9]{32}$/.test(id);
const randomId = () => crypto.randomUUID().replaceAll("-", "");
function json(data: unknown, status = 200, cookie?: string) {
    const headers = new Headers({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    if (cookie) headers.set("Set-Cookie", cookie);
    return new Response(JSON.stringify(data), { status, headers });
}
function errorResponse(error: unknown) {
    if (error instanceof TripError) return json({ error: error.message }, error.status);
    console.error("trip_request_failed", error instanceof Error ? error.message : "unknown");
    return json({ error: "旅程暫時無法更新，請稍後再試。" }, 503);
}
async function bodyObject(request: Request): Promise<Record<string, unknown>> {
    if (!request.headers.get("content-type")?.includes("application/json")) throw new TripError("請使用 JSON 傳送旅程資訊。", 415);
    const reader = request.body?.getReader();
    if (!reader) throw new TripError("缺少旅程資訊。");
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 4096) { await reader.cancel(); throw new TripError("旅程資訊太長。", 413); }
        chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { const value = JSON.parse(new TextDecoder().decode(bytes)); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(); return value; }
    catch { throw new TripError("旅程資訊格式不正確。"); }
}
export async function GET(request: Request) {
    try {
        const id = new URL(request.url).searchParams.get("room"), token = tokenFromRequest(request);
        if (!validId(id)) throw new TripError("旅程連結格式不正確。");
        if (!token) throw new TripError("請先加入這段旅程。", 401);
        return json(await readRoom(id, await sessionHash(token)));
    } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
    try {
        const origin = request.headers.get("origin");
        if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== new URL(request.url).origin)) throw new TripError("請從旅程頁面操作。", 403);
        const input = await bodyObject(request), action = input.action;
        if (!["create", "join", "depart", "arrive", "gather", "chat", "start"].includes(String(action))) throw new TripError("不支援這個操作。");
        const existingToken = tokenFromRequest(request);
        if (!existingToken && action !== "create" && action !== "join") throw new TripError("請先加入旅程。", 401);
        const token = existingToken ?? randomId(), hash = await sessionHash(token), db = roomDatabase(), now = Date.now();
        let id = input.roomId;
        if (action === "create" || action === "join") {
            const name = typeof input.name === "string" ? input.name.trim() : "";
            if (!name || Array.from(name).length > 16 || /[\u0000-\u001f\u007f]/.test(name)) throw new TripError("暱稱請使用 1 到 16 個字。");
            const avatar = input.avatar;
            if (typeof avatar !== "number" || !Number.isInteger(avatar) || avatar < 0 || avatar > 3) throw new TripError("請選一位旅人。");
            if (action === "create") {
                id = randomId();
                await db.batch([
                    db.prepare("INSERT INTO rooms (id, host_hash, created_at, expires_at) VALUES (?, ?, ?, ?)").bind(id, hash, now, now + 7 * 86400000),
                    db.prepare("INSERT INTO members (id, room_id, session_hash, name, avatar, updated_at) VALUES (?, ?, ?, ?, ?, ?)").bind(randomId(), id, hash, name, avatar, now),
                ]);
            } else {
                if (!validId(id)) throw new TripError("旅程連結格式不正確。");
                const room = await db.prepare("SELECT meeting FROM rooms WHERE id = ? AND expires_at > ?").bind(id, now).first<{ meeting: string }>();
                if (!room) throw new TripError("找不到這段旅程，或旅程已超過七天。", 404);
                const existing = await db.prepare("SELECT id FROM members WHERE room_id = ? AND session_hash = ?").bind(id, hash).first();
                if (!existing) {
                    const inserted = await db.prepare("INSERT INTO members (id, room_id, session_hash, name, avatar, destination, origin, updated_at) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM members WHERE room_id = ?) < 12").bind(randomId(), id, hash, name, avatar, room.meeting, room.meeting, now, id).run();
                    if (inserted.meta.changes !== 1) throw new TripError("這段旅程已經有 12 位朋友了。", 409);
                }
            }
        } else {
            if (!validId(id)) throw new TripError("旅程連結格式不正確。");
            const state = await readRoom(id, hash), self = state.members.find((member) => member.id === state.selfId)!;
            if (action === "chat") {
                const kind = input.kind, content = typeof input.content === "string" ? input.content.trim() : "";
                if (kind !== "text" && kind !== "sticker") throw new TripError("訊息類型不正確。");
                if (!content || Array.from(content).length > 200 || /[\u0000-\u001f\u007f]/.test(content)) throw new TripError("訊息請使用 1 到 200 個字。");
                if (kind === "sticker" && !stickers.includes(content)) throw new TripError("請選擇貼圖列上的貼圖。");
                const inserted = await db.prepare("INSERT INTO messages (id, room_id, member_id, kind, content, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM messages WHERE member_id = ? AND created_at > ?)").bind(randomId(), id, self.id, kind, content, now, self.id, now - 900).run();
                if (inserted.meta.changes !== 1) throw new TripError("慢一點，上一則訊息才剛送出。", 429);
            } else if (action === "depart") {
                if (!isPlaceId(input.destination)) throw new TripError("請選擇地圖上的地點。");
                if (!state.started) throw new TripError("等隊長設定集合地，開始冒險後再出發。", 409);
                if (self.status === "walking") throw new TripError("請先確認抵達，再選下一站。", 409);
                await db.prepare("UPDATE members SET origin = destination, destination = ?, status = 'walking', started_at = ?, updated_at = ? WHERE id = ? AND room_id = ? AND session_hash = ? AND status <> 'walking'").bind(input.destination, now, now, self.id, id, hash).run();
            } else if (action === "arrive") {
                await db.prepare("UPDATE members SET status = 'arrived', origin = destination, updated_at = ? WHERE id = ? AND room_id = ? AND session_hash = ?").bind(now, self.id, id, hash).run();
            } else {
                if (!state.host) throw new TripError("由開啟旅程的朋友設定集合點。", 403);
                if (!isPlaceId(input.meeting)) throw new TripError("請選擇集合地點。");
                if (action === "start") await db.prepare("UPDATE rooms SET meeting = ?, gathering = 1, started = 1 WHERE id = ? AND host_hash = ?").bind(input.meeting, id, hash).run();
                else await db.prepare("UPDATE rooms SET meeting = ?, gathering = 1 WHERE id = ? AND host_hash = ?").bind(input.meeting, id, hash).run();
            }
        }
        if (!validId(id)) throw new TripError("旅程連結格式不正確。");
        const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
        return json(await readRoom(id, hash), 200, `ximen_session=${token}; HttpOnly; SameSite=Lax; Path=/api; Max-Age=604800${secure}`);
    } catch (error) { return errorResponse(error); }
}
