export type PlaceId = "lobby" | "cinema" | "street" | "donki" | "noodles" | "wannian" | "redhouse";
export type Member = { id: string; name: string; avatar: number; destination: PlaceId; origin: PlaceId; status: "idle" | "walking" | "arrived"; startedAt: number; updatedAt: number; };
export type ChatMessage = { id: string; memberId: string; name: string; avatar: number; kind: "text" | "sticker"; content: string; createdAt: number; };
export const stickers = ["👋", "☕", "✨", "🍜", "🐧", "🏃"];
export type RoomState = { id: string; meeting: PlaceId; gathering: boolean; started: boolean; members: Member[]; messages: ChatMessage[]; selfId: string; host: boolean; };
export const places = [
    { id: "lobby" as PlaceId, name: "西門站 6 號出口", category: "集合地點", note: "在出口旁的廣場等彼此，從這裡開始今天的散策。", x: 54, y: 78, color: "#37564c" },
    { id: "cinema" as PlaceId, name: "電影街", category: "看場電影", note: "走進電影街，挑一部想看的故事。", x: 26, y: 27, color: "#725c76" },
    { id: "street" as PlaceId, name: "西門徒步區", category: "逛逛街", note: "跟著好奇心走，在街角發現新的小店。", x: 51, y: 24, color: "#886936" },
    { id: "donki" as PlaceId, name: "唐吉訶德", category: "尋找好物", note: "留一點時間，慢慢尋寶。", x: 76, y: 29, color: "#466779" },
    { id: "noodles" as PlaceId, name: "阿宗麵線", category: "吃點小食", note: "來一碗熱麵線，替散策補充能量。", x: 27, y: 50, color: "#a76142" },
    { id: "wannian" as PlaceId, name: "萬年大樓", category: "挖寶探索", note: "收藏、模型與老街記憶，慢慢挖寶。", x: 50, y: 53, color: "#665c42" },
    { id: "redhouse" as PlaceId, name: "西門紅樓", category: "藝文散步", note: "紅磚、老建築和創意小店，慢慢走，也慢慢看。", x: 77, y: 73, color: "#9a513b" },
];
export const placeById = (id: string) => places.find((place) => place.id === id) ?? places[0];
export const isPlaceId = (id: unknown): id is PlaceId => typeof id === "string" && places.some((place) => place.id === id);
export const animationDuration = 10000;
export function memberPosition(member: Member, now: number) {
    const start = placeById(member.origin), end = placeById(member.destination);
    const progress = member.status === "walking" ? Math.max(0, Math.min(1, (now - member.startedAt) / animationDuration)) : 1;
    return { x: start.x + (end.x - start.x) * progress, y: start.y + (end.y - start.y) * progress - Math.sin(progress * Math.PI) * 4 };
}
export function demoRoom(): RoomState {
    return { id: "demo", meeting: "lobby", gathering: false, started: false, selfId: "m1", host: true, messages: [{ id: "welcome", memberId: "m2", name: "小晴", avatar: 1, kind: "text", content: "到了 👋", createdAt: 0 }], members: ["阿牧", "小晴", "阿哲", "悠悠"].map((name, index) => ({ id: `m${index + 1}`, name, avatar: index, destination: "lobby", origin: "lobby", status: "idle", startedAt: 0, updatedAt: 0 })) };
}
