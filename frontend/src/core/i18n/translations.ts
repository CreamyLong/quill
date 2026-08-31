import type { Locale } from "./locale";
import { enUS, zhCN, koKR, jaJP, frFR, ruRU, esES, arSA, type Translations } from "./locales";

export const translations: Record<Locale, Translations> = {
  "en-US": enUS,
  "zh-CN": zhCN,
  "ko-KR": koKR,
  "ja-JP": jaJP,
  "fr-FR": frFR,
  "ru-RU": ruRU,
  "es-ES": esES,
  "ar-SA": arSA,
};
