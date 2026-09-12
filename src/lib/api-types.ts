export interface TtsRequest {
  /** исходный SSML (или простой текст) */
  script: string;
  /** "single" — один голос на весь файл, "perSpeaker" — свой голос каждому */
  mode: "single" | "perSpeaker";
  voice: string;
  speakerVoices?: Record<string, string>;
  /** значение для <prosody rate="...">, например "105%" */
  rate?: string | null;
  /** убирать "Moderator:" из произносимого текста */
  stripLabels?: boolean;
  /** байтовый лимит куска, по умолчанию 4600 */
  maxBytes?: number;
  /** дополнительный множитель темпа поверх prosody */
  speakingRate?: number;
  pitch?: number;
}

export interface TtsErrorResponse {
  error: string;
  detail?: string;
}
