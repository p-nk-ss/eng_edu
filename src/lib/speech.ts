/** Browser text-to-speech for dictation (Kokoro replaces it in M5). */
export function speechAvailable(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof window.SpeechSynthesisUtterance === "function";
}

export function speak(text: string): boolean {
  if (!speechAvailable()) return false;
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new window.SpeechSynthesisUtterance(text);
  const voices = synth.getVoices();
  const voice = voices.find((v) => v.lang === "en-GB") ?? voices.find((v) => v.lang.startsWith("en")) ?? null;
  if (voice) u.voice = voice;
  u.lang = voice?.lang ?? "en-GB";
  u.rate = 0.9;
  synth.speak(u);
  return true;
}
