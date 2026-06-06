/** SocialAI Pro commercial pricing — modeled for Bangladesh market. */

export type PlanId = "trial" | "pro" | "elite" | "enterprise";
export type ChannelId = "messenger" | "whatsapp" | "instagram";

export interface PlanDefinition {
  id: PlanId;
  name: string;
  priceBdt: number | null;
  priceLabel: string;
  subtitle: string;
  popular?: boolean;
  messagesPerMonth: number;
  maxUsers: number;
  channels: ChannelId[];
  features: string[];
}

export const PLANS: Record<PlanId, PlanDefinition> = {
  trial: {
    id: "trial",
    name: "Trial",
    priceBdt: 0,
    priceLabel: "Free",
    subtitle: "Try SocialAI Pro for 14 days",
    messagesPerMonth: 500,
    maxUsers: 1,
    channels: ["messenger"],
    features: [
      "500 messages",
      "Messenger inbox",
      "Suggestive AI",
      "Comment automation",
      "Multilingual support",
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceBdt: 12500,
    priceLabel: "৳12,500",
    subtitle: "Growing teams up to 8 users",
    popular: true,
    messagesPerMonth: 18000,
    maxUsers: 8,
    channels: ["messenger", "whatsapp", "instagram"],
    features: [
      "18,000 messages / month",
      "Omnichannel inbox",
      "Messenger + WhatsApp + Instagram",
      "Suggestive AI",
      "Comment automation",
      "Image supported replies",
      "Multilingual support",
      "Orders & Excel export",
    ],
  },
  elite: {
    id: "elite",
    name: "Elite",
    priceBdt: 26000,
    priceLabel: "৳26,000",
    subtitle: "Growing teams up to 10 users",
    messagesPerMonth: 40000,
    maxUsers: 10,
    channels: ["messenger", "whatsapp", "instagram"],
    features: [
      "40,000 messages / month",
      "Omnichannel inbox",
      "Messenger + WhatsApp + Instagram",
      "Suggestive AI",
      "Comment automation",
      "Image supported replies",
      "Multilingual support",
      "Priority support",
    ],
  },
  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    priceBdt: null,
    priceLabel: "Custom",
    subtitle: "For enterprise solutions",
    messagesPerMonth: -1,
    maxUsers: -1,
    channels: ["messenger", "whatsapp", "instagram"],
    features: [
      "Custom message volume",
      "Unlimited team members",
      "Omnichannel inbox",
      "Dedicated onboarding",
      "Custom integrations",
      "SLA & priority support",
    ],
  },
};

export function getPlan(planId: string): PlanDefinition {
  return PLANS[(planId as PlanId) in PLANS ? (planId as PlanId) : "trial"];
}

export function listPublicPlans(): PlanDefinition[] {
  return [PLANS.pro, PLANS.elite, PLANS.enterprise];
}

export function planAllowsChannel(planId: string, channel: ChannelId): boolean {
  return getPlan(planId).channels.includes(channel);
}
