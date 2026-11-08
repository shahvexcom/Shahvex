import { db } from "@/lib/database";

export type BpoCreditContacts = {
  whatsappUrl: string;
  instagramUrl: string;
  messengerUrl: string;
  updatedAt: string | null;
};

export async function getBpoCreditContacts(): Promise<BpoCreditContacts> {
  const result = await (await db()).query(
    `SELECT whatsapp_url,instagram_url,messenger_url,updated_at
     FROM bpo_credit_contact_settings WHERE id=1`,
  );
  const row = result.rows[0];
  return {
    whatsappUrl: row?.whatsapp_url || process.env.NEXT_PUBLIC_BPO_WHATSAPP || "https://wa.me/",
    instagramUrl: row?.instagram_url || process.env.NEXT_PUBLIC_BPO_INSTAGRAM || "https://instagram.com/",
    messengerUrl: row?.messenger_url || process.env.NEXT_PUBLIC_BPO_MESSENGER || "https://m.me/",
    updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}
