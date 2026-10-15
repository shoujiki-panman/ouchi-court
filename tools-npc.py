# コン太とポン子の決めゼリフを AivisSpeech（Mac で動く無料の読み上げ・ACML 1.0 で商用可・クレジット任意）で作り、public/voice/ に置く。
# ブラウザの読み上げは声が変だった（10/16）。決めゼリフだけ声を入れ、長いセリフは文字で出す（ダンガンロンパも一部だけ声が入る）。
import json, os, subprocess, tempfile, urllib.parse, urllib.request
B = "http://127.0.0.1:10101"
KON = {  # コン太：まお「からかい」を少し低く・早口に（生意気なキツネの男の子）
  "objection": "異議あり！",
  "doukana": "それはどうかな？",
  "chotto": "ちょっと待った！その意見には穴があるよ！",
  "gunu": "ぐぬぬ……！そこを突かれるとは……！",
  "iisugi": "くっ、今のはちょっと言いすぎたか……！",
  "madamada": "まだまだ！次のラウンドで取り返してやる！",
  "kuzurenai": "ふふん、ぼくの言い分は崩れないよ！",
  "dousita": "どうした？撃ち抜けなかったみたいだね！",
  "zannen": "残念！ぼくの勝ちが近づいてきたかな？",
  "hantai": "でも、反対の理由だってちゃんとあるんだよ！",
  "chigau": "本当にそうかな？ぼくはちがうと思うね！",
}
PON = {  # ポン子：コハク「あまあま」を明るく（子どもの味方の弁護人）
  "nice": "ナイス論破！バッチリ効いたね！",
  "kimatta": "それは違うよ、決まったー！その調子！",
  "sugoi": "すごい！コン太の弱いところ、ちゃんと見抜いたね！",
  "daijoubu": "だいじょうぶ！次で取り返そう！",
  "oshii": "おしい！黄色いところをよく見てね！",
  "gyakuten": "まだ逆転できるよ、がんばって！",
}
def synth(text, style, out, pitch, speed, inton):
    q = json.load(urllib.request.urlopen(urllib.request.Request(f"{B}/audio_query?" + urllib.parse.urlencode({"text": text, "speaker": style}), method="POST")))
    q.update(speedScale=speed, pitchScale=pitch, intonationScale=inton)
    w = os.path.join(tempfile.mkdtemp(), "a.wav")
    open(w, "wb").write(urllib.request.urlopen(urllib.request.Request(f"{B}/synthesis?speaker={style}", data=json.dumps(q).encode(), headers={"content-type": "application/json"}, method="POST")).read())
    subprocess.check_call(["ffmpeg", "-y", "-loglevel", "error", "-i", w, "-b:a", "80k", out])
for key, text in KON.items():
    synth(text, 888753764, f"public/voice/kon-{key}.mp3", -0.05, 1.15, 1.5)
for key, text in PON.items():
    synth(text, 1878365377, f"public/voice/pon-{key}.mp3", 0.04, 1.08, 1.4)
print(len(os.listdir("public/voice")), "clips", sum(os.path.getsize(f"public/voice/{f}") for f in os.listdir("public/voice")) // 1024, "KB")
