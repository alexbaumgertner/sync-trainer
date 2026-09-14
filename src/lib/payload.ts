// Без пометки server-only намеренно: модуль используют и маршруты Next,
// и скрипты обслуживания, которые исполняются вне Next. В клиентский код он
// не попадёт — тянет за собой Payload и доступ к базе.
import { getPayload, type Payload } from "payload";
import config from "@payload-config";

let instance: Promise<Payload> | null = null;

/** Один экземпляр на процесс: инициализация Payload дорогая. */
export const payloadClient = (): Promise<Payload> => (instance ??= getPayload({ config }));
