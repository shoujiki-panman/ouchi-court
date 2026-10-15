# 法廷のキャラ絵と背景を Gemini の画像モデルで作る（既にある Gemini の鍵を使う）。どの既存作品の絵も参照しない、オリジナルのデザイン。
import base64, json, os, subprocess, sys, urllib.request, concurrent.futures as cf
KEY = subprocess.check_output(["security", "find-generic-password", "-a", os.environ["USER"], "-s", "GEMINI_API_KEY", "-w"]).decode().strip()
STYLE = ("Original character design, Japanese anime illustration, bold black outlines, high-contrast cel shading, "
         "pop art accents in hot pink and neon purple, dramatic lighting, half-body portrait facing slightly left, "
         "plain solid black background, no text, no logo, no watermark, kid-friendly, expressive face.")
ART = {
  "judge": "A chubby tanuki (Japanese raccoon dog) as a pompous but lovable chief judge, wearing a black judge's robe and a tiny gold crown, holding a wooden gavel, smug confident grin. " + STYLE,
  "bailiff": "A young tanuki as a court clerk host with a pink bow tie and round glasses, holding a scroll and a microphone, energetic showman pose. " + STYLE,
  "lawyerP": "A panda girl defense attorney in a sharp pink suit, pointing forward dramatically with determination. " + STYLE,
  "lawyerD": "A fox boy defense attorney in a navy suit with a red tie, smirking and crossing arms, cool rival vibe. " + STYLE,
  "witness": "A cheerful cartoon child silhouette standing at a witness podium, glowing pink rim light, faceless simple stylized figure. " + STYLE,
  "stage": ("A dramatic circular courtroom seen from slightly above, 8 podiums arranged in a ring facing the center, "
            "black floor with hot pink and neon purple light beams, spotlights, tense game-show atmosphere, no people, no text. "
            "Japanese anime background art, bold, high contrast, wide 16:9."),
}
def gen(name, prompt, model):
    body = {"contents": [{"parts": [{"text": prompt}]}], "generationConfig": {"responseModalities": ["IMAGE"]}}
    req = urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        data=json.dumps(body).encode(), headers={"x-goog-api-key": KEY, "content-type": "application/json"})
    try:
        j = json.load(urllib.request.urlopen(req, timeout=180))
    except urllib.error.HTTPError as e:
        return name, f"error {e.code} {e.read()[:200]}"
    for p in j["candidates"][0]["content"]["parts"]:
        if "inlineData" in p:
            raw = f"public/img/{name}.raw"
            open(raw, "wb").write(base64.b64decode(p["inlineData"]["data"]))
            out = f"public/img/{name}.jpg"
            subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "82", "-Z", "1280" if name == "stage" else "640", raw, "--out", out], capture_output=True)
            os.remove(raw)
            return name, f"ok {os.path.getsize(out)//1024}KB"
    return name, "no image"
model = sys.argv[1] if len(sys.argv) > 1 else "gemini-3.1-flash-image"
with cf.ThreadPoolExecutor(6) as ex:
    for r in ex.map(lambda kv: gen(kv[0], kv[1], model), ART.items()): print(*r)
