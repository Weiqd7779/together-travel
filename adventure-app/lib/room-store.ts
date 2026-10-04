import { env } from "cloudflare:workers";
import type { ChatMessage, Member, PlaceId, RoomState } from "./travel";

export class TripError extends Error {
    constructor(message: string, public status = 400) { super(message); }
}
export function roomDatabase() {
    if (!env.DB) throw new TripError("多人旅程暫時無法連線，請稍後再試。", 503);
    return env.DB.withSession("first-primary");
}
export async function sessionHash(token: string) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export async function readRoom(id: string, hash: string): Promise<RoomState> {
    const db = roomDatabase();
    const room = await db.prepare("SELECT id, meeting, gathering, started, host_hash FROM rooms WHERE id = ? AND expires_at > ?").bind(id, Date.now()).first<{ id: string; meeting: PlaceId; gathering: number; started: number; host_hash: string }>();
    if (!room) throw new TripError("找不到這段旅程，或旅程已超過七天。", 404);
    const self = await db.prepare("SELECT id FROM members WHERE room_id = ? AND session_hash = ?").bind(id, hash).first<{ id: string }>();
    if (!self) throw new TripError("請先加入這段旅程。", 401);
    const result = await db.prepare("SELECT id, name, avatar, destination, origin, status, started_at AS startedAt, updated_at AS updatedAt FROM members WHERE room_id = ? ORDER BY updated_at, id").bind(id).all<Member>();
    const chat = await db.prepare("SELECT msg.id, msg.member_id AS memberId, m.name, m.avatar, msg.kind, msg.content, msg.created_at AS createdAt FROM messages msg JOIN members m ON m.id = msg.member_id WHERE msg.room_id = ? ORDER BY msg.created_at DESC, msg.id DESC LIMIT 50").bind(id).all<ChatMessage>();
    return { id: room.id, meeting: room.meeting, gathering: room.gathering === 1, started: room.started === 1, host: room.host_hash === hash, selfId: self.id, members: result.results, messages: chat.results.reverse() };
}
