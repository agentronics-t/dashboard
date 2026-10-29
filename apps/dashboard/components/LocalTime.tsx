"use client";

import { useEffect, useState } from "react";

// Times are shown in the visitor's own time zone. The server renders in UTC,
// so the text is filled in after hydration (a blank of the right width until then).
const FORMATS = {
  time: { hour: "numeric", minute: "2-digit", second: "2-digit" },
  datetime: { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
  date: { month: "short", day: "numeric", year: "numeric" }
} satisfies Record<string, Intl.DateTimeFormatOptions>;

export function LocalTime({ at, format = "datetime" }: { at: Date | string; format?: keyof typeof FORMATS }) {
  const d = new Date(at);
  const [text, setText] = useState<string | null>(null);
  const [full, setFull] = useState<string | undefined>(undefined);
  useEffect(() => {
    setText(d.toLocaleString(undefined, FORMATS[format]));
    setFull(d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "long" }));
  }, [d.getTime(), format]);
  return (
    <time dateTime={d.toISOString()} title={full} style={text ? undefined : { visibility: "hidden" }}>
      {text ?? d.toISOString().slice(format === "date" ? 0 : 11, format === "date" ? 10 : 19)}
    </time>
  );
}

/** The visitor's time zone, e.g. "GMT+5:30" or "PDT". */
export function useTimeZoneName(): string | null {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    setName(new Intl.DateTimeFormat(undefined, { timeZoneName: "short" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? null);
  }, []);
  return name;
}
