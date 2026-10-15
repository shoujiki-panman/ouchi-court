# 観客の声（ざわざわ・えーっ 等）を AivisSpeech（Mac で動く無料の読み上げ）で何人分か作り、
# 声の高さを変えて少しずつずらして重ねて「観客」にする。できた mp3 は public/crowd/ に置く。
import json, os, subprocess, tempfile, urllib.parse, urllib.request
B = "http://127.0.0.1:10101"
LINES = {
  "zawa": ["ざわ…ざわ…", "えー、どういうこと…", "ざわざわ…", "なになに…？", "ひそひそ…"],
  "ee": ["えーーっ！？", "えぇーっ！", "うそーっ！", "えーっ！？", "まじー！？"],
  "oo": ["おおーーっ！", "おーっ！！", "すげー！", "おおお！", "いいぞー！"],
  "maji": ["まじで…？", "ほんとに…？", "えー…", "うそでしょ…", "まじか…"],
  "ganbare": ["がんばれー！", "いけー！", "まけるなー！", "がんばれ！", "ファイトー！"],
  "yatta": ["わーーっ！", "やったー！", "ぱちぱちぱち！", "おめでとー！", "わーい！"],
}
# まお・コハクの声の種類（id）と、声の高さ（倍率）で、大人・子どもっぽさを散らす
VOICES = [(888753761, 1.0), (888753764, 1.12), (1878365376, 0.88), (888753762, 1.2), (1878365377, 0.95)]
def synth(text, style, out):
    q = json.load(urllib.request.urlopen(urllib.request.Request(f"{B}/audio_query?" + urllib.parse.urlencode({"text": text, "speaker": style}), method="POST")))
    q["speedScale"] = 1.1
    q["intonationScale"] = 1.4
    open(out, "wb").write(urllib.request.urlopen(urllib.request.Request(f"{B}/synthesis?speaker={style}", data=json.dumps(q).encode(), headers={"content-type": "application/json"}, method="POST")).read())
for name, lines in LINES.items():
    d = tempfile.mkdtemp()
    args, fl = [], []
    for i, (style, pitch) in enumerate(VOICES):
        f = os.path.join(d, f"{i}.wav")
        synth(lines[i], style, f)
        args += ["-i", f]
        delay = [0, 220, 480, 120, 350][i]
        pan = [0.3, -0.5, 0.6, -0.2, 0.0][i]
        l, r = (1 - pan if pan > 0 else 1), (1 + pan if pan < 0 else 1)
        fl.append(f"[{i}:a]asetrate=44100*{pitch},aresample=44100,aformat=channel_layouts=mono,adelay={delay},volume=0.5,pan=stereo|c0={l:.2f}*c0|c1={r:.2f}*c0[a{i}]")
    fl.append("".join(f"[a{i}]" for i in range(len(VOICES))) + "amix=inputs=5:normalize=0,aecho=0.8:0.5:50|90:0.3|0.2,afade=t=out:st=2.4:d=0.8[out]")
    out = f"public/crowd/{name}.mp3"
    subprocess.check_call(["ffmpeg", "-y", "-loglevel", "error"] + args + ["-filter_complex", ";".join(fl), "-map", "[out]", "-t", "3.2", "-b:a", "96k", out])
    print(name, os.path.getsize(out) // 1024, "KB")
