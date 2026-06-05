export type ItemStatus = "pending" | "approved" | "sent" | "ignored" | "failed";
export type PostStatus = "draft" | "scheduled" | "published" | "failed";
export type Direction = "in" | "out";

export interface Conversation {
  id: number;
  psid: string;
  customer_name: string | null;
  last_message: string | null;
  unread: number;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: number;
  conversation_id: number;
  direction: Direction;
  text: string;
  ai_draft: string | null;
  status: ItemStatus;
  created_at: string;
}

export interface CommentItem {
  id: number;
  fb_comment_id: string;
  post_id: string | null;
  from_name: string | null;
  message: string;
  ai_draft: string | null;
  status: ItemStatus;
  created_at: string;
}

export interface PostItem {
  id: number;
  message: string;
  image_url: string | null;
  link: string | null;
  status: PostStatus;
  scheduled_at: string | null;
  fb_post_id: string | null;
  error: string | null;
  created_at: string;
}

export interface AiResult {
  text: string;
  provider: string;
  model: string;
}
