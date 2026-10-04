CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`session_hash` text NOT NULL,
	`name` text NOT NULL,
	`avatar` integer NOT NULL,
	`destination` text DEFAULT 'lobby' NOT NULL,
	`origin` text DEFAULT 'lobby' NOT NULL,
	`status` text DEFAULT 'idle' NOT NULL,
	`started_at` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `members_room_session` ON `members` (`room_id`,`session_hash`);--> statement-breakpoint
CREATE INDEX `members_room_updated` ON `members` (`room_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`host_hash` text NOT NULL,
	`meeting` text DEFAULT 'lobby' NOT NULL,
	`gathering` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
