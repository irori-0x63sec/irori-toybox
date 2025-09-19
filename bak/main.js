// main.js (Canvas連携 / 2段ヒント / 累積公開 / 安全ガード付き)

const startBtn        = document.getElementById("startBtn");
const restartBtn      = document.getElementById("restartBtn");
const answerInput     = document.getElementById("answer-input");
const submitBtn       = document.getElementById("submit-btn");
const hintTextElem    = document.getElementById("hint-text");     // 下段：文字が徐々に開示されるヒント or 正解表示
const hintMeaningElem = document.getElementById("hint-meaning");  // 上段：意味ヒント（固定文言）
const feedbackElem    = document.getElementById("feedback");

let wordList = [];
let currentIndex = 0;
let missCount = 0;
let revealedIndices = []; // 公開済みインデックス（累積）
let isGameOver = false;

// ユーティリティ
const setText = (el, text) => { if (el) el.textContent = text; };
const showEl  = (el) => { if (el) el.style.display = ""; };
const hideEl  = (el) => { if (el) el.style.display = "none"; };

// 忘却曲線っぽい重み抽選
function pickNextWord() {
  if (!wordList.length) return 0;
  const weights = wordList.map(w => {
    const cs = w.correctStreak ?? 0;
    const lm = w.lastMistake   ?? 0;
    let score = 1;
    if (cs >= 2) score *= 0.2; // 連続正解は出にくく
    if (lm === 0) score *= 3;  // 直近ミスは出やすく
    return Math.max(score, 0.0001);
  });
  const total = weights.reduce((a,b)=>a+b, 0) || 1;
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return 0;
}

// 累積公開ヒントを生成
function getHintWithRevealedLetters(answer, revealed) {
  return answer
    .split("")
    .map((ch, i) => (revealed.includes(i) ? ch : "_"))
    .join(" ");
}

function loadWord() {
  if (!wordList.length || isGameOver) return;

  missCount = 0;
  revealedIndices = [];

  const word = wordList[currentIndex];

  // 上段：意味ヒント
  setText(hintMeaningElem, `Hint: ${word.hint}`);

  // 下段：文字ヒント（初期は全隠し）
  setText(hintTextElem, getHintWithRevealedLetters(word.answer, revealedIndices));

  // 入力・結果リセット
  if (answerInput) { answerInput.value = ""; answerInput.disabled = false; }
  if (submitBtn) submitBtn.disabled = false;
  setText(feedbackElem, "");

  // 隕石出現（canvas側でBaseに向かって進む）
  if (window.canvasGame?.spawnMeteor) {
    window.canvasGame.spawnMeteor();
  }
}

function checkAnswer() {
  if (isGameOver) return;

  const wordObj = wordList[currentIndex];
  const correctAnswer = wordObj.answer.toLowerCase();
  const userInput = (answerInput?.value || "").trim().toLowerCase();

  if (userInput === correctAnswer) {
    // 正解 → 隕石爆破 → 次の問題
    if (window.canvasGame?.blastLastMeteor) {
      window.canvasGame.blastLastMeteor();
    }
    wordObj.correctStreak = (wordObj.correctStreak || 0) + 1;
    wordObj.lastMistake = 99;
    setText(feedbackElem, "✅ Correct!");

    setTimeout(() => {
      currentIndex = pickNextWord();
      loadWord();
    }, 1000);
  } else {
    // 不正解 → 1文字ずつ追加公開（上段は上書きしない）
    setText(feedbackElem, "❌ Try again!");
    missCount++;

    const unrevealed = [...Array(correctAnswer.length).keys()].filter(i => !revealedIndices.includes(i));
    if (unrevealed.length > 0) {
      const idx = unrevealed[Math.floor(Math.random() * unrevealed.length)];
      revealedIndices.push(idx);
    }
    setText(hintTextElem, getHintWithRevealedLetters(correctAnswer, revealedIndices));

    wordObj.correctStreak = 0;
    wordObj.lastMistake = 0;
  }
}

// 🔔 BaseヒットでGameOver（canvas.jsが dispatchEvent してくれる）
window.addEventListener("meteorHitBase", () => {
  isGameOver = true;
  setText(feedbackElem, "💥 Game Over!");

  // ▼下段に正解を表示（上段はそのまま意味ヒントを維持）
  const correctWord = wordList[currentIndex]?.answer || "";
  setText(hintTextElem, `Answer: ${correctWord}`);

  if (answerInput) answerInput.disabled = true;
  if (submitBtn)  submitBtn.disabled  = true;
  showEl(restartBtn);
});

// Restart
restartBtn?.addEventListener("click", () => {
  isGameOver = false;
  hideEl(restartBtn);
  setText(feedbackElem, "");
  currentIndex = pickNextWord();
  loadWord();
});

// Start
startBtn?.addEventListener("click", () => {
  fetch("data/wordlist.json")
    .then(res => res.json())
    .then(data => {
      wordList = Array.isArray(data) ? data : [];
      currentIndex = pickNextWord();

      // Canvas開始
      if (window.canvasGame?.start) {
        window.canvasGame.start();
      }

      loadWord();
      hideEl(startBtn);
      hideEl(restartBtn); // 使ってなければ隠す
    })
    .catch(err => {
      console.error("Failed to load word list:", err);
      setText(feedbackElem, "⚠ Failed to load word list.");
    });
});

// 送信
submitBtn?.addEventListener("click", checkAnswer);
answerInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") checkAnswer();
});
