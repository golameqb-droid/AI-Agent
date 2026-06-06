export type ItemStatus = "pending" | "approved" | "sent" | "ignored" | "failed";
export type PostStatus = "draft" | "scheduled" | "published" | "failed";
export type Direction = "in" | "out";
export type VendorStatus = "trial" | "active" | "suspended" | "cancelled";
export type HandoffStatus = "ai" | "human_requested" | "human_active";

export type Channel = "messenger" | "whatsapp" | "instagram";

export interface Conversation {
  id: number;
  vendor_id: number;
  channel: Channel;
  psid: string;
  customer_name: string | null;
  last_message: string | null;
  unread: number;
  handoff_status: HandoffStatus;
  handoff_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: number;
  conversation_id: number;
  direction: Direction;
  text: string;
  ai_draft: string | null;
  image_url: string | null;
  status: ItemStatus;
  created_at: string;
}

export type OrderStatus = "pending" | "confirmed" | "shipped" | "delivered" | "cancelled";

export interface OrderItem {
  product_id?: number;
  name: string;
  qty: number;
  price?: string;
}

export interface Order {
  id: number;
  vendor_id: number;
  conversation_id: number | null;
  order_number: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  items_json: string;
  total: string | null;
  notes: string | null;
  status: OrderStatus;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: number;
  vendor_id: number;
  name: string;
  description: string | null;
  price: string | null;
  image_url: string | null;
  link: string | null;
  active: number;
  sort_order: number;
  created_at: string;
}

export interface CommentItem {
  id: number;
  vendor_id: number;
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
  vendor_id: number;
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
  tokensIn?: number;
  tokensOut?: number;
}
