# コン太とポン子の決めゼリフを Gemini の読み上げ（司会と同じ系統の自然な声）で作り、public/voice/ に置く。
# AivisSpeech の男性モデルはカタコトだった（10/16「めちゃカタコト」）。セリフは決まっているので一度作れば使い回せる。
# 使い方: kc run GEMINI_API_KEY -- python3 tools-npc-gemini.py [key ...]（key を省くと全部）
import base64, json, os, subprocess, sys, tempfile, time, urllib.request
KEY = os.environ["GEMINI_API_KEY"]
sys.path.insert(0, os.path.dirname(__file__))
CAST = {
    # 無料枠はモデルごとに別なので、キャラごとにモデルを分ける（1キャラの中では声がそろう）
    "kon": ("gemini-2.5-flash-preview-tts", "Fenrir", "生意気で自信満々なキツネの男の子の弁護士として、早口で、得意げに・悔しそうに感情たっぷりに言って"),
    "pon": ("gemini-2.5-flash-preview-tts", "Achird", "子どもの味方の、明るくて頼れるパンダのお兄さん弁護士として、元気よく、ほめるように言って"),
}
src = open(os.path.join(os.path.dirname(__file__), "tools-npc.py")).read()
ns = {}
exec(src.split("def synth")[0].split("import json")[0] + src.split("B = ")[1].split("\n", 1)[1].split("def synth")[0], ns)
LINES = {f"kon-{k}": v for k, v in ns["KON"].items()} | {f"pon-{k}": v for k, v in ns["PON"].items()}
os.makedirs("public/voice/gemini", exist_ok=True)
# 作り置き先は public/voice/gemini/。キャラ1人分がそろったら public/voice/ に上書きする（1人の中で声が混ざらないように）
want = sys.argv[1:] or [n for n in LINES if not os.path.exists(f"public/voice/gemini/{n}.mp3")]
for name in want:
    MODEL, voice, style = CAST[name[:3]]
    body = {
        "contents": [{"parts": [{"text": f"{style}:「{LINES[name]}」"}]}],
        "generationConfig": {"responseModalities": ["AUDIO"], "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}}},
    }
    for attempt in range(6):
        try:
            req = urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent", data=json.dumps(body).encode(), headers={"x-goog-api-key": KEY, "content-type": "application/json"})
            out = json.load(urllib.request.urlopen(req, timeout=90))
            pcm = base64.b64decode(out["candidates"][0]["content"]["parts"][0]["inlineData"]["data"])
            break
        except urllib.error.HTTPError as e:
            print(name, "retry", e.code, file=sys.stderr)
            time.sleep(22)
    else:
        # 枠切れ：このセリフは飛ばして、あとで作り直す（今の声のまま残る）
        print(name, "SKIPPED (quota)")
        continue
    raw = os.path.join(tempfile.mkdtemp(), "a.pcm")
    open(raw, "wb").write(pcm)
    subprocess.check_call(["ffmpeg", "-y", "-loglevel", "error", "-f", "s16le", "-ar", "24000", "-ac", "1", "-i", raw, "-af", "silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse", "-b:a", "80k", f"public/voice/gemini/{name}.mp3"])
    print(name, voice, os.path.getsize(f"public/voice/gemini/{name}.mp3") // 1024, "KB")
