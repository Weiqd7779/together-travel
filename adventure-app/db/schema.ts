import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const rooms = sqliteTable("rooms", {
    id: text("id").primaryKey(),
    hostHash: text("host_hash").notNull(),
    meeting: text("meeting").notNull().default("lobby"),
    gathering: integer("gathering").notNull().default(0),
    started: integer("started").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
});
export const members = sqliteTable("members", {
    id: text("id").primaryKey(),
    roomId: text("room_id").notNull().references(() => rooms.id, { onDelete: "cascade" }),
    sessionHash: text("session_hash").notNull(),
    name: text("name").notNull(),
    avatar: integer("avatar").notNull(),
    destination: text("destination").notNull().default("lobby"),
    origin: text("origin").notNull().default("lobby"),
    status: text("status").notNull().default("idle"),
    startedAt: integer("started_at").notNull().default(0),
    updatedAt: integer("updated_at").notNull(),
}, (table) => [uniqueIndex("members_room_session").on(table.roomId, table.sessionHash), index("members_room_updated").on(table.roomId, table.updatedAt)]);
export const messages = sqliteTable("messages", {
    id: text("id").primaryKey(),
    roomId: text("room_id").notNull().references(() => rooms.id, { onDelete: "cascade" }),
    memberId: text("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    content: text("content").notNull(),
    createdAt: integer("created_at").notNull(),
}, (table) => [index("messages_room_created").on(table.roomId, table.createdAt), index("messages_member_created").on(table.memberId, table.createdAt)]);
