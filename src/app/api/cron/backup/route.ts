import { NextResponse } from "next/server";
import { CRON_FORBIDDEN, cronAuthorized } from "@/lib/cron-auth";
import { list, put, del } from "@vercel/blob";
import { createDump, summarize, encryptDump, backupKey } from "@/lib/backup";
import { purgeStaleCodes } from "@/lib/otp";
import { sendEmail, emailConfigured } from "@/lib/email";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Сколько копий держать. Дальше — старые удаляются. */
const KEEP = 14;

/** Больше этого в письмо не вкладываем: почта не хранилище. */
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

const PREFIX = "backups/";

/**
 * Суточная резервная копия базы (D5).
 *
 * Копия всегда ложится в **приватный** Blob — это другой провайдер, чем база,
 * и потому переживает беду на стороне Neon. В письмо она вкладывается только
 * зашифрованной: в копии адреса приглашённых и глоссарии, а глоссарии бывают
 * привязаны к конкретным клиентам. Без ключа письмо получает только сводку
 * и говорит, как шифрование включить.
 */
export async function GET(request: Request): Promise<Response> {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: CRON_FORBIDDEN }, { status: 401 });
  }

  // Уборка до снятия копии: иначе копия тащит с собой сутки мусора.
  // Ошибка здесь не повод не делать копию — копия важнее уборки.
  let purged = 0;
  try {
    purged = await purgeStaleCodes();
  } catch (error) {
    console.error("[backup] старые коды не убраны", error);
  }

  try {
    const dump = await createDump();
    const plain = Buffer.from(JSON.stringify(dump), "utf8");

    const key = backupKey();
    const body = key ? encryptDump(plain, key) : plain;
    const name = `${PREFIX}${dump.createdAt.slice(0, 19).replace(/[:T]/g, "-")}.json${
      key ? ".enc" : ""
    }`;

    let stored: string | null = null;
    if (process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
      const { pathname } = await put(name, body, {
        access: "private",
        addRandomSuffix: false,
        contentType: "application/octet-stream",
      });
      stored = pathname;
      await rotate();
    }

    await notify({ dump, body, key: Boolean(key), stored });

    return NextResponse.json({
      ok: true,
      rows: dump.tables.reduce((sum, t) => sum + t.rows.length, 0),
      purgedCodes: purged,
      bytes: body.byteLength,
      encrypted: Boolean(key),
      stored,
    });
  } catch (error) {
    // Молчаливо упавшая копия хуже отсутствующей: про отсутствующую знаешь.
    console.error("[backup] копия не сделана", error);
    await sendEmail({
      to: process.env.BACKUP_EMAIL?.trim() || process.env.ADMIN_EMAIL?.trim() || "",
      subject: "Резервная копия НЕ сделана",
      text: `Суточная копия базы не создана.\n\n${(error as Error).message}`,
    }).catch(() => {});
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

/** Оставляем последние KEEP копий: место в Blob не бесконечное. */
async function rotate(): Promise<void> {
  const { blobs } = await list({ prefix: PREFIX, limit: 1000 });
  const extra = blobs
    .sort((a, b) => b.pathname.localeCompare(a.pathname))
    .slice(KEEP);
  if (extra.length) await del(extra.map((b) => b.url));
}

async function notify(args: {
  dump: Awaited<ReturnType<typeof createDump>>;
  body: Buffer;
  key: boolean;
  stored: string | null;
}): Promise<void> {
  const to = process.env.BACKUP_EMAIL?.trim() || process.env.ADMIN_EMAIL?.trim();
  if (!to || !emailConfigured()) return;

  const attach = args.key && args.body.byteLength <= MAX_ATTACHMENT_BYTES;

  const lines = [
    `Копия базы за ${args.dump.createdAt.slice(0, 10)}.`,
    "",
    summarize(args.dump),
    "",
    `Размер: ${(args.body.byteLength / 1024).toFixed(0)} КБ`,
    args.stored ? `В хранилище: ${args.stored}` : "В хранилище НЕ записана: нет токена Blob.",
  ];

  if (!args.key) {
    lines.push(
      "",
      "Копия НЕ зашифрована, поэтому во вложение не пошла: в ней адреса " +
        "приглашённых и глоссарии. Чтобы получать её письмом, задайте BACKUP_KEY " +
        "(openssl rand -base64 32) и храните ключ в менеджере паролей — " +
        "потеря ключа означает потерю копий.",
    );
  } else if (!attach) {
    lines.push("", "Копия выросла и во вложение не поместилась — берите её из хранилища.");
  }

  await sendEmail({
    to,
    subject: `Копия базы за ${args.dump.createdAt.slice(0, 10)}`,
    text: lines.join("\n"),
    ...(attach
      ? {
          attachments: [
            {
              filename: `sync-trainer-${args.dump.createdAt.slice(0, 10)}.json.enc`,
              content: args.body,
            },
          ],
        }
      : {}),
  });
}
