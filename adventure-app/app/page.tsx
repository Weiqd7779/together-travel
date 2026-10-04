"use client";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Map, Users, MapPin, Footprints, Flag, Plus, Minus, Compass, X, Check, Link2, Send, Smile, Sparkles, Radio, LoaderCircle } from "lucide-react";
import { animationDuration, demoRoom, memberPosition, placeById, places, stickers, type PlaceId, type RoomState } from "../lib/travel";

function Character({ avatar }: { avatar: number }) {
    return <span aria-hidden="true" className="character" style={{ "--avatar": avatar % 4 } as CSSProperties} />;
}
export default function HomePage() {
    const [room, setRoom] = useState<RoomState>(demoRoom);
    const [selected, setSelected] = useState<PlaceId>("redhouse");
    const [now, setNow] = useState(0);
    const [modal, setModal] = useState<"lobby" | "room" | "destinations" | "friends" | "maps" | "meeting" | null>(null);
    const [meetingChoice, setMeetingChoice] = useState<PlaceId>("lobby");
    const [screen, setScreen] = useState<"lobby" | "map">("lobby");
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const dragRef = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
    const mapWorldRef = useRef<HTMLDivElement>(null);
    const [zoom, setZoom] = useState(1);
    const [name, setName] = useState("");
    const [avatar, setAvatar] = useState(0);
    const [invite, setInvite] = useState("");
    const [roomId, setRoomId] = useState("");
    const [pending, setPending] = useState(false);
    const [sync, setSync] = useState("示範旅程");
    const [toast, setToast] = useState("");
    const [details, setDetails] = useState(false);
    const [chatDraft, setChatDraft] = useState("");
    const [showStickers, setShowStickers] = useState(false);
    const chatRef = useRef<HTMLDivElement>(null);
    const pollRef = useRef(false), roomRef = useRef(room), dialogRef = useRef<HTMLDialogElement>(null);
    roomRef.current = room;
    const self = room.members.find((member) => member.id === room.selfId) ?? room.members[0];
    const place = placeById(selected), meeting = placeById(room.meeting);
    const arrived = room.members.filter((member) => member.destination === room.meeting && member.status !== "walking");
    const isDemo = room.id === "demo";
    const announce = useCallback((message: string) => setToast(message), []);
    useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(""), 4500); return () => window.clearTimeout(timer); }, [toast]);
    useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 100); return () => window.clearInterval(timer); }, []);
    useEffect(() => {
        if (!isDemo) return;
        setRoom((previous) => previous.members.some((member) => member.status === "walking" && now - member.startedAt >= animationDuration) ? { ...previous, members: previous.members.map((member) => member.status === "walking" && now - member.startedAt >= animationDuration ? { ...member, status: "arrived", origin: member.destination, updatedAt: now } : member) } : previous);
    }, [now, isDemo]);
    useEffect(() => { const id = new URL(window.location.href).searchParams.get("room"); if (id && /^[a-f0-9]{32}$/.test(id)) { setRoomId(id); setInvite(id); setModal("room"); } }, []);
    useEffect(() => { const dialog = dialogRef.current; if (modal && dialog && !dialog.open) dialog.showModal(); if (!modal && dialog?.open) dialog.close(); }, [modal]);
    const request = useCallback(async (action: string, values: Record<string, unknown> = {}) => {
        const response = await fetch("/api/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, roomId: roomRef.current.id, ...values }) });
        const data = await response.json() as RoomState & { error?: string };
        if (!response.ok) throw new Error(data.error || "目前無法更新，請稍後再試。");
        setRoom(data as RoomState); setSync("已同步"); return data as RoomState;
    }, []);
    useEffect(() => {
        if (!roomId) return;
        let active = true;
        const poll = async () => {
            if (document.hidden || pollRef.current) return;
            pollRef.current = true;
            try {
                const response = await fetch(`/api/rooms?room=${roomId}`, { cache: "no-store" });
                if (!response.ok) { if (response.status === 401) { setModal("room"); setSync("請加入旅程"); } else setSync("連線暫停 · 正在重試"); return; }
                const data: RoomState = await response.json();
                if (active) { const unjoined = roomRef.current.id !== data.id; setRoom(data); setSync("已同步"); if (unjoined) setModal((previous) => previous === "room" ? null : previous); }
            } catch { if (active) setSync("連線暫停 · 正在重試"); } finally { pollRef.current = false; }
        };
        void poll(); const timer = window.setInterval(() => void poll(), 3000); document.addEventListener("visibilitychange", poll);
        return () => { active = false; window.clearInterval(timer); document.removeEventListener("visibilitychange", poll); };
    }, [roomId]);
    const depart = useCallback(async (destination: PlaceId) => {
        const current = roomRef.current, member = current.members.find((item) => item.id === current.selfId);
        if (!member) throw new Error("請先加入旅程。");
        if (!current.started) throw new Error("等隊長設定集合地，開始冒險後再出發。");
        if (member.status === "walking") throw new Error("請先確認抵達，再選下一站。");
        if (member.destination === destination) { announce(`你已經在${placeById(destination).name}了。`); return; }
        if (current.id === "demo") setRoom((previous) => ({ ...previous, members: previous.members.map((item) => item.id === previous.selfId ? { ...item, origin: item.destination, destination, status: "walking", startedAt: Date.now() } : item) }));
        else await request("depart", { destination });
        setScreen("map"); setModal(null); setDetails(false);
        announce(`${member.name}出發了，下一站：${placeById(destination).name}。`);
    }, [request, announce]);
    const run = async (action: () => Promise<unknown>) => { setPending(true); try { await action(); } catch (error) { announce((error as Error).message); } finally { setPending(false); } };
    const confirmArrival = async () => {
        if (isDemo) setRoom((previous) => ({ ...previous, members: previous.members.map((member) => member.id === previous.selfId ? { ...member, status: "arrived", origin: member.destination } : member) }));
        else await request("arrive"); announce(`${self.name}已抵達${placeById(self.destination).name}。`);
    };
    const gather = async () => { if (isDemo) setRoom((previous) => ({ ...previous, gathering: true, meeting: selected })); else await request("gather", { meeting: selected }); announce(`一起在${placeById(selected).name}集合，先到的人可以稍等一下。`); };
    const createOrJoin = async (joining: boolean) => {
        if (!name.trim()) throw new Error("先留下你的暱稱吧。");
        let target = invite.trim(); if (target.includes("?")) target = new URL(target).searchParams.get("room") ?? "";
        if (joining && !/^[a-f0-9]{32}$/.test(target)) throw new Error("請貼上朋友分享的完整旅程連結。");
        const data = await request(joining ? "join" : "create", { name: name.trim(), avatar, roomId: target });
        setRoomId(data.id); setModal(null); const url = new URL(window.location.href); url.searchParams.set("room", data.id); window.history.replaceState({}, "", url);
        announce(joining ? "你加入旅程了，和大家打個招呼吧。" : "旅程已開啟。複製連結，邀請朋友進大廳。");
    };
    const copyInvite = async () => {
        if (isDemo) { setModal("room"); return; }
        try { await navigator.clipboard.writeText(window.location.href); announce("旅程連結已複製，貼給同行的朋友吧。"); }
        catch { setInvite(window.location.href); setModal("room"); announce("可在邀請欄選取並複製旅程連結。"); }
    };
    const sendMessage = async (content: string, kind: "text" | "sticker") => {
        if (!content.trim()) return;
        if (isDemo) setRoom((previous) => ({ ...previous, messages: [...previous.messages, { id: crypto.randomUUID(), memberId: self.id, name: self.name, avatar: self.avatar, kind, content: content.trim(), createdAt: Date.now() }].slice(-50) }));
        else await request("chat", { content, kind });
        setChatDraft(""); setShowStickers(false);
    };
    const startAdventure = async () => {
        if (!room.host) throw new Error("等隊長開始冒險。");
        if (isDemo) setRoom((previous) => ({ ...previous, meeting: meetingChoice, started: true, gathering: true }));
        else await request("start", { meeting: meetingChoice });
        setModal(null); setScreen("map"); setDetails(false);
        announce("冒險開始！旗幟就是我們的集合地。");
    };
    const startedRef = useRef(false);
    useEffect(() => { if (room.started && !startedRef.current) { setScreen("map"); setModal(null); } startedRef.current = room.started; }, [room.started]);
    useEffect(() => { if (screen !== "map" || !mapWorldRef.current) return; const goal = placeById(room.meeting); setPan({ x: Math.max(-470, Math.min(470, (50 - goal.x) * mapWorldRef.current.clientWidth / 100)), y: Math.max(-100, Math.min(100, (50 - goal.y) * mapWorldRef.current.clientHeight / 100)) }); }, [screen, room.meeting]);
    useEffect(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; }, [room.messages.length, screen]);
    useEffect(() => {
        type ModelContext = { registerTool: (tool: object, options: { signal: AbortSignal }) => void | Promise<void> };
        const context = (document as Document & { modelContext?: ModelContext }).modelContext;
        if (!context?.registerTool) return;
        const lifecycle = new AbortController();
        const definitions = [
            { name: "read_adventure", description: "Read the current team, meeting flag, and member locations.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: true }, execute: () => roomRef.current },
            { name: "depart_for_place", description: "Move your traveler to a selected destination after the captain starts the adventure.", inputSchema: { type: "object", properties: { destination: { type: "string", enum: places.map((item) => item.id) } }, required: ["destination"], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute: async (input: { destination: string }) => { if (!places.some((item) => item.id === input?.destination)) throw new Error("Unknown destination"); await depart(input.destination as PlaceId); return { destination: input.destination }; } },
        ];
        definitions.forEach((definition) => { try { void Promise.resolve(context.registerTool(definition, { signal: lifecycle.signal })).catch(() => {}); } catch {} });
        return () => lifecycle.abort();
    }, [depart]);
    return <div className="mobile-app">
        <header className="app-header"><div className="app-mark"><Users size={21} /><span>同行</span></div><button className="map-selector" onClick={() => setModal("maps")}><Map size={14} />西門町<span>⌄</span></button><button className="room-badge" onClick={() => setModal("room")}><Radio size={12} />{sync}</button></header>
        <div className="app-content">
        {screen === "lobby" ? <section className="waiting-room epic-lobby">
            <img className="lobby-background" src="/art/lobby.png" alt="暮光中的西門町集合廣場，暖金燈火與深色紙片建築" draggable={false} />
            <div className="lobby-shade" />
            <div className="lobby-location"><Flag size={15} /><span>{meeting.name}</span><small><Users size={12} />{arrived.length}/{room.members.length}</small></div>
            <div className="lobby-characters">{room.members.map((member, index) => <button key={member.id} className={`lobby-person ${member.id === room.selfId ? "you" : ""} ${member.destination === room.meeting && member.status !== "walking" ? "here" : "away"}`} style={{ animationDelay: `${index * 160}ms` }} onClick={() => { if (isDemo) setRoom((previous) => ({ ...previous, selfId: member.id })); }} aria-label={`${member.name}${member.id === room.selfId ? "，你" : ""}`}>
                {room.messages.filter((message) => message.createdAt > 0 && message.memberId === member.id && now - message.createdAt < 6000).slice(-1).map((message) => <span key={message.id} className={`speech-bubble ${message.kind}`}>{message.content}</span>)}
                <Character avatar={member.avatar} /><strong>{member.name}{member.id === room.selfId && <em>你</em>}</strong><span className="lobby-state">{member.status === "walking" ? <Footprints size={13} /> : member.destination === room.meeting ? <Check size={13} /> : <Compass size={13} />}</span>
            </button>)}</div>
            <div className="chat-area" ref={chatRef} role="log" aria-label="大廳聊天" aria-live="polite">{room.messages.slice(-3).map((message) => <div key={message.id} className={`chat-entry ${message.memberId === room.selfId ? "is-self" : ""} ${message.kind}`}><strong>{message.name}</strong><p>{message.content}</p></div>)}</div>
            <div className="lobby-controls">{showStickers && <div className="sticker-tray" aria-label="貼圖選擇">{stickers.map((sticker) => <button key={sticker} aria-label={`發送貼圖 ${sticker}`} disabled={pending} onClick={() => void run(() => sendMessage(sticker, "sticker"))}>{sticker}</button>)}</div>}
            <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); void run(() => sendMessage(chatDraft, "text")); }}><button type="button" className="sticker-toggle" aria-label="開啟貼圖" aria-expanded={showStickers} onClick={() => setShowStickers(!showStickers)}><Smile size={22} /></button><input aria-label="大廳聊天訊息" value={chatDraft} maxLength={200} onChange={(event) => setChatDraft(event.target.value)} placeholder="聊兩句…" /><button type="submit" aria-label="送出訊息" disabled={pending || !chatDraft.trim()}><Send size={18} /></button></form>
            <button className="app-primary depart-button" disabled={!room.host && !room.started} onClick={() => setModal(room.started ? "destinations" : "maps")}><Footprints size={19} />{room.started ? "選目的地" : room.host ? "選地圖，開始冒險" : "等待隊長開始"}</button></div>
        </section> : <section className="live-map" aria-label="西門町手繪互動地圖">
            <div className="map-top-strip"><span>西門町</span><button onClick={() => setModal("friends")}><Users size={14} />{room.members.length} 位夥伴</button></div>
            <div className="map-canvas" onPointerDown={(event) => { if ((event.target as HTMLElement).closest("button")) return; dragRef.current = { x: event.clientX, y: event.clientY, startX: pan.x, startY: pan.y }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (!dragRef.current) return; setPan({ x: Math.max(-470, Math.min(470, dragRef.current.startX + event.clientX - dragRef.current.x)), y: Math.max(-80, Math.min(80, dragRef.current.startY + event.clientY - dragRef.current.y)) }); }} onPointerUp={() => { dragRef.current = null; }} onPointerCancel={() => { dragRef.current = null; }}>
                <div className="map-world" ref={mapWorldRef} style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
                    <img src="/art/ximen-map.png" className="map-art" alt="西門町手繪平面示意地圖，有主要街道和知名店家圖示" draggable={false} />
                    <svg className="route-layer" viewBox="0 0 100 66.667" preserveAspectRatio="none" aria-hidden="true">{room.members.filter((member) => member.status === "walking").map((member) => { const start = placeById(member.origin), end = placeById(member.destination); return <path key={member.id} d={`M ${start.x} ${start.y * 2 / 3} Q ${(start.x + end.x) / 2} ${(start.y + end.y) / 3 - 5} ${end.x} ${end.y * 2 / 3}`} fill="none" stroke={["#526274", "#af893e", "#b16e53", "#5b8880"][member.avatar % 4]} strokeWidth="0.4" strokeDasharray="0.8 0.7" />; })}</svg>
                    {places.map((item) => <button key={item.id} style={{ left: `${item.x}%`, top: `${item.y}%`, "--pin-color": item.color } as CSSProperties} className={`place-pin ${selected === item.id && details ? "selected" : ""}`} onClick={() => { setSelected(item.id); setDetails(true); }} aria-label={`選擇${item.name}`}>{room.meeting === item.id && <span className="meeting-flag"><Flag size={28} fill="#dbc17a" /></span>}<span className="pin-label">{item.name}</span></button>)}
                    {room.members.map((member, index) => { const position = memberPosition(member, now), peers = room.members.filter((other) => other.destination === member.destination), offset = (peers.findIndex((other) => other.id === member.id) - (peers.length - 1) / 2) * 4; return <div key={member.id} className={`traveler ${member.status === "walking" ? "walking" : "waiting"} ${member.id === room.selfId ? "self" : ""}`} style={{ left: `${position.x + offset}%`, top: `${position.y}%`, zIndex: 15 + index }}><span className="avatar-token"><Character avatar={member.avatar} /></span><span className="traveler-name">{member.name}{member.status !== "walking" && member.destination === room.meeting && <Check size={10} />}</span></div>; })}
                </div>
            </div>
            <div className="map-tools"><button aria-label="放大地圖" disabled={zoom >= 1.6} onClick={() => setZoom(Math.min(1.6, zoom + .2))}><Plus size={19} /></button><button aria-label="縮小地圖" disabled={zoom <= .65} onClick={() => setZoom(Math.max(.65, zoom - .2))}><Minus size={19} /></button><button aria-label="重設地圖" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}><Compass size={20} /></button></div>
            <div className="map-caption">手繪示意 · 可拖曳地圖</div>
            {room.gathering && <div className="gather-banner"><Flag size={16} /><span>大家約在 <strong>{meeting.name}</strong></span><button onClick={() => { setSelected(room.meeting); setDetails(true); }}>查看</button></div>}
            <div className="map-status-card">{self.status === "walking" ? <><span className="status-symbol"><Footprints size={22} /></span><div><small>正在前往</small><strong>{placeById(self.destination).name}</strong></div><button className="compact-primary" disabled={pending} onClick={() => void run(confirmArrival)}><Check size={16} /> 我已抵達</button></> : <><span className="status-symbol"><MapPin size={22} /></span><div><small>{self.destination === room.meeting ? "你在集合點" : "你目前在"}</small><strong>{placeById(self.destination).name}</strong></div><button className="compact-primary" onClick={() => setModal("destinations")}>選下一站</button></>}</div>
            {details && <div className="map-place-sheet"><span className="sheet-handle" /><button className="sheet-close" aria-label="關閉地點介紹" onClick={() => setDetails(false)}><X size={20} /></button><div className="place-category">{place.category}</div><h2>{place.name}</h2><p>{place.note}</p><div className="place-actions"><button className="app-primary" disabled={pending || self.status === "walking" || self.destination === selected} onClick={() => void run(() => depart(selected))}><Footprints size={18} />{self.destination === selected ? "你在這裡" : "出發去這裡"}</button>{room.host && <button className="outline-action" disabled={pending} onClick={() => void run(gather)}><Flag size={18} />約在這裡</button>}</div></div>}
        </section>}
        </div>
        <nav className="bottom-nav" aria-label="底部導覽"><button className={screen === "lobby" ? "active" : ""} onClick={() => { setScreen("lobby"); setDetails(false); }}><Flag size={22} /><span>大廳</span></button><button className={screen === "map" ? "active" : ""} onClick={() => { if (!room.started) setModal("maps"); else setScreen("map"); setDetails(false); }}><Map size={22} /><span>地圖</span></button><button onClick={() => setModal("friends")}><Users size={22} /><span>夥伴</span><b>{room.members.length}</b></button><button onClick={() => void copyInvite()}><Link2 size={22} /><span>邀請</span></button></nav>
        <dialog ref={dialogRef} className={`app-sheet ${modal === "room" ? "room-sheet" : ""}`} onCancel={() => setModal(null)} onClick={(event) => { if (event.target === dialogRef.current) setModal(null); }}><span className="sheet-handle" /><button className="sheet-close" aria-label="關閉面板" onClick={() => setModal(null)}><X size={21} /></button>
        {modal === "maps" ? <><span className="eyebrow">CHOOSE YOUR WORLD</span><h2>選一張地圖</h2><button className="world-card" onClick={() => { setMeetingChoice(room.meeting); setModal(room.host ? "meeting" : "friends"); }}><img src="/art/ximen-map.png" alt="西門町手繪地圖" /><span><strong>西門町</strong><small>TAIPEI · 7 個探索地點</small></span><Check size={19} /></button></> : modal === "meeting" ? <><span className="eyebrow">CAPTAIN, PLANT YOUR FLAG</span><h2>隊長，約在哪裡？</h2><div className="destination-list">{places.map((item) => <button key={item.id} className={`destination-option ${meetingChoice === item.id ? "chosen" : ""}`} onClick={() => setMeetingChoice(item.id)}><Flag size={19} /><span><strong>{item.name}</strong></span><span className="radio-choice">{meetingChoice === item.id && <Check size={14} />}</span></button>)}</div><button className="app-primary gold-action" disabled={pending || !room.host} onClick={() => void run(startAdventure)}><Compass size={20} />開始冒險</button></> : modal === "destinations" ? <><span className="eyebrow">YOUR NEXT LITTLE ADVENTURE</span><h2>下一站，想去哪？</h2><p className="sheet-subtitle">{self.name}，挑一個喜歡的地方。</p><div className="destination-list">{places.filter((item) => item.id !== "lobby").map((item) => <button key={item.id} className={`destination-option ${selected === item.id ? "chosen" : ""}`} onClick={() => setSelected(item.id)}><span className="destination-thumb" style={{ backgroundPosition: `${item.x}% ${item.y}%` }} /><span><strong>{item.name}</strong><small>{item.category}</small></span><span className="radio-choice">{selected === item.id && <Check size={14} />}</span></button>)}</div><button className="app-primary" disabled={pending || self.status === "walking" || self.destination === selected} onClick={() => void run(() => depart(selected))}><Footprints size={19} />{self.destination === selected ? "你已在這裡" : `出發去${place.name}`}</button>{self.status === "walking" && <p className="sheet-subtitle">先在地圖確認抵達，再選下一站。</p>}</> : modal === "friends" || modal === "lobby" ? <><span className="eyebrow">TOGETHER, WHEREVER WE GO</span><h2>大家在哪裡？</h2><p className="sheet-subtitle">{isDemo ? "示範模式：點選夥伴可切換旅人。" : "每 3 秒同步 · 由本人回報抵達"}</p><div className="friend-list">{room.members.map((member) => <button key={member.id} className={`friend-row ${member.id === room.selfId ? "is-you" : ""}`} onClick={() => { if (isDemo) setRoom((previous) => ({ ...previous, selfId: member.id })); setSelected(member.destination); }}><div className="friend-portrait"><Character avatar={member.avatar} /></div><div><strong>{member.name}{member.id === room.selfId && <em>你</em>}</strong><span>{placeById(member.destination).name}</span><small>{member.status === "walking" ? "前往中" : member.destination === room.meeting ? "已抵達集合點" : "探索中"}</small></div>{member.status === "walking" ? <Footprints size={19} /> : <Check size={18} />}</button>)}</div><div className="meeting-summary"><Flag size={19} /><div><small>集合地點</small><strong>{meeting.name}</strong></div><b>{arrived.length}/{room.members.length} 已到</b></div><button className="app-primary" disabled={pending || self.status === "walking"} onClick={() => { if (self.destination === room.meeting) { setScreen("lobby"); setModal(null); } else void run(() => depart(room.meeting)); }}><Flag size={18} />{self.destination === room.meeting ? "回到等待大廳" : "我先去集合"}</button></> : <><span className="eyebrow">A STORY WE SHARE</span><h2>朋友到齊，故事開始。</h2><p className="sheet-subtitle">留下暱稱，選一位紙片旅人。</p><label htmlFor="traveler-name">你的暱稱</label><input id="traveler-name" value={name} maxLength={16} onChange={(event) => setName(event.target.value)} placeholder="大家怎麼稱呼你？" autoComplete="nickname" /><div className="avatar-options">{[0, 1, 2, 3].map((item) => <button key={item} className={avatar === item ? "chosen" : ""} aria-label={`選擇旅人 ${item + 1}`} aria-pressed={avatar === item} onClick={() => setAvatar(item)}><Character avatar={item} />{avatar === item && <Check size={16} />}</button>)}</div><button className="app-primary" disabled={pending} onClick={() => void run(() => createOrJoin(false))}>{pending ? <LoaderCircle className="spin" size={18} /> : <Plus size={18} />}開啟新旅程</button><div className="or-divider">或加入朋友的旅程</div><label htmlFor="invite-link">旅程邀請連結</label><input id="invite-link" value={invite} onChange={(event) => setInvite(event.target.value)} placeholder="貼上朋友分享的連結" /><button className="outline-action full-width" disabled={pending} onClick={() => void run(() => createOrJoin(true))}><Users size={18} />加入旅程</button>{!isDemo && <button className="copy-room" onClick={() => void copyInvite()}><Link2 size={16} /> 複製這段旅程的連結</button>}</>}
        </dialog>
        {toast && <div className="app-notice" role="status"><Sparkles size={16} />{toast}</div>}
    </div>;
}
