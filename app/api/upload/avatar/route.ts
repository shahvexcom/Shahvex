import { v2 as cloudinary } from "cloudinary";
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { ADMIN_SESSION_COOKIE, AGENT_SESSION_COOKIE, BPO_SESSION_COOKIE, readSession } from "@/lib/session";
import { requireApprovedBpo } from "@/lib/bpo-session";

cloudinary.config({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET });

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = await readSession(cookieStore.get(ADMIN_SESSION_COOKIE)?.value) ?? await readSession(cookieStore.get(AGENT_SESSION_COOKIE)?.value) ?? await readSession(cookieStore.get(BPO_SESSION_COOKIE)?.value);
  if (!session) return Response.json({ message: "Unauthenticated" }, { status: 401 });
  if (session.role === "BPO" && !await requireApprovedBpo()) return Response.json({ message: "Account access is blocked." }, { status: 403 });
  const formData = await request.formData();
  const file = formData.get("avatar");
  if (!(file instanceof File) || !file.type.startsWith("image/")) return Response.json({ message: "Please select a valid image file." }, { status: 400 });
  if (file.size > 5 * 1024 * 1024) return Response.json({ message: "Image must be smaller than 5 MB." }, { status: 400 });
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const result = await new Promise<{ secure_url: string }>((resolve, reject) => cloudinary.uploader.upload_stream({ folder: "max7-ai/avatars", public_id: `${session.agentId}-${randomUUID()}`, resource_type: "image", transformation: [{ width: 400, height: 400, crop: "fill", gravity: "face" }] }, (error, upload) => error || !upload ? reject(error || new Error("Upload failed")) : resolve(upload)).end(bytes));
    return Response.json({ url: result.secure_url });
  } catch { return Response.json({ message: "Avatar upload failed. Please try again." }, { status: 503 }); }
}
