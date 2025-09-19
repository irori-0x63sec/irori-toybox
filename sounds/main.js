let wordList = [];
let currentIndex = 0;
let meteorY = 10;
let meteorInterval = null;
let missCount = 0;
let revealedIndices = [];

const startBtn = document.getElementById("startBtn");
const hintTextElem = document.getElementById("hint-text");
const hintRevealElem = document.getElementById("hint-reveal");
const meteorElem = document.getElementById("meteor");
const inputElem = document.getElementById("answer-input");
const buttonElem = document.getElementById("submit-btn");
const blastSound = new Audio('sounds/blast.wav');
blastSound.volume = 0.6;

const correctAnswerElem = document.getElementById("correct-answer");
const feedbackElem = document.getElementById("feedback");
const baseElem = document.getElementById("base");
const gameOverSound = new Audio('sounds/gameover.wav');
gameOverSound.volume = 0.8;

const restartBtn = document.getElementById("restartBtn");
const gameContainer = document.getElementById("game-container");
const loadingMessage = document.getElementById("loading-message");

const maxFallY = 250;

function pickNextWord() {
  const weights = wordList.map(w => {
    let score = 1;
    score *= 1 / (1 + w.correctStreak);
    score *= 1 + (10 - Math.min(w.lastMistake, 10));
    return score;
  });

  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < wordList.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return 0;
}

function getHintWithRevealedLetters(answer, revealed) {
  return answer
    .split("")
    .map((c, i) => (revealed.includes(i) ? c : "_"))
    .join(" ");
}

function startFalling() {
  clearInterval(meteorInterval);
  meteorY = 10;
  meteorElem.style.top = `${meteorY}px`;

  meteorInterval = setInterval(() => {
    meteorY += 1.5;
    meteorElem.style.top = `${meteorY}px`;

    const meteorRect = meteorElem.getBoundingClientRect();
    const baseRect = baseElem.getBoundingClientRect();

    const isCollision =
      meteorRect.bottom >= baseRect.top &&
      meteorRect.top <= baseRect.bottom &&
      meteorRect.right >= baseRect.left &&
      meteorRect.left <= baseRect.right;

    if (isCollision) {
      gameOver();
    }
  }, 50);
}

function gameOver() {
  clearInterval(meteorInterval);
  gameOverSound.play();
  feedbackElem.textContent = "💥 Game Over!";
  meteorElem.textContent = "💥";
  baseElem.style.opacity = "0";
  inputElem.disabled = true;
  buttonElem.disabled = true;

  correctAnswerElem.textContent = `Correct answer: ${wordList[currentIndex].answer}`;
  correctAnswerElem.style.display = "block";
  restartBtn.style.display = "inline-block";
}

function restartGame() {
  feedbackElem.textContent = "";
  restartBtn.style.display = "none";
  baseElem.style.opacity = 1;

  meteorElem.style.top = "0px";
  meteorElem.textContent = "🪨";
  meteorElem.style.opacity = 1;

  inputElem.disabled = false;
  buttonElem.disabled = false;
  inputElem.value = "";

  currentIndex = pickNextWord();
  loadWord();
}

function checkAnswer() {
  const userInput = inputElem.value.trim().toLowerCase();
  const wordObj = wordList[currentIndex];
  const correctAnswer = wordObj.answer.toLowerCase();

  if (userInput === correctAnswer) {
    blastSound.play();
    meteorElem.textContent = "💥";
    clearInterval(meteorInterval);

    wordObj.correctStreak = (wordObj.correctStreak || 0) + 1;
    wordObj.lastMistake = 99;

    setTimeout(() => {
      currentIndex = pickNextWord();
      loadWord();
    }, 1000);
  } else {
    feedbackElem.textContent = "❌ Try again!";
    missCount++;
    meteorY += 10;
    meteorElem.style.top = `${meteorY}px`;

    const unrevealed = [...Array(correctAnswer.length).keys()].filter(i => !revealedIndices.includes(i));
    if (unrevealed.length > 0) {
      const randIndex = unrevealed[Math.floor(Math.random() * unrevealed.length)];
      revealedIndices.push(randIndex);
    }

    const easyHint = getHintWithRevealedLetters(correctAnswer, revealedIndices);
    hintTextElem.textContent = "Hint: " + wordObj.hint;
    hintRevealElem.textContent = easyHint;
    
    wordObj.correctStreak = 0;
    wordObj.lastMistake = 0;
  }
}

function loadWord() {
  if (wordList.length === 0) return;

  missCount = 0;
  revealedIndices = [];

  const word = wordList[currentIndex];
  hintTextElem.textContent = "Hint: " + word.hint;
  hintRevealElem.textContent = "Hint letters: " + getHintWithRevealedLetters(word.answer, []);
  correctAnswerElem.textContent = "";
  correctAnswerElem.style.display = "none";
  inputElem.value = "";
  feedbackElem.textContent = "";
  meteorElem.style.opacity = 1;
  meteorElem.textContent = "🪨";

  wordList.forEach(w => {
    if (w.lastMistake !== undefined && w.lastMistake < 99) {
      w.lastMistake++;
    }
  });

  startFalling();
}

// 初回ロード時
gameContainer.style.display = "none";
startBtn.style.display="none";
loadingMessage.textContent = "Loading...";

//最初にwordlistを読み込んでからStartボタンを表示
fetch("data/wordlist.json")
  .then(res => res.json())
  .then(data => {
    wordList = data;
    currentIndex = pickNextWord();
    loadingMessage.style.display = "none";
    startBtn.style.display="inline-block";
  })
  .catch(err => {
    console.error("Failed to load word list:", err);
    feedbackElem.textContent = "⚠ Failed to load word list.";
  });

//Startボタン押下でゲーム開始
startBtn.addEventListener("click", () => {
  startBtn.style.display = "none";
  gameContainer.style.display = "block";
  loadWord();
});

buttonElem.addEventListener("click", checkAnswer);
inputElem.addEventListener("keydown", (e) => {
  if (e.key === "Enter") checkAnswer();
});
restartBtn.addEventListener("click", restartGame);
