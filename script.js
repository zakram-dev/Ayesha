const messages = {
  welcome: [
    "Ayesha, I hope today leaves at least one small reason for you to smile. You deserve that much, and more.",
    "A small reminder, Ayesha: you do not have to make every day extraordinary for it to be meaningful.",
    "There is something quietly wonderful about being exactly who you are. Keep that part close."
  ],
  sunny: [
    "Let the good mood be a little bit contagious today. Your light belongs in the room.",
    "May the easy moments find you: warm tea, kind people, a thought that makes you grin.",
    "Ayesha, if the day is already lovely, here is permission to enjoy every bright little piece of it."
  ],
  soft: [
    "Go gently with yourself. Not everything needs to be figured out at once.",
    "A soft day is still a real day. Rest is not falling behind; it is being human.",
    "Ayesha, take this as a tiny pause: inhale, exhale, and let the world wait one minute."
  ],
  brave: [
    "You have made it through every version of hard that came before this. That counts for something.",
    "Courage can look like one quiet next step. You are allowed to take it slowly.",
    "Ayesha, you are more capable than the doubtful voice in your head gives you credit for."
  ],
  distract: [
    "A very serious question: if clouds could choose a flavor, would they be vanilla, cotton candy, or something completely unexpected?",
    "Tiny thought: somewhere, a cat is sitting in a sunbeam and has absolutely no meetings to attend.",
    "Imagine finding a pocket-sized door in a library. Behind it: a tiny reading room, tea, and zero notifications.",
    "Official permission slip: you may take a five-minute break and call it research on being alive.",
    "If today feels loud, remember that the moon is just out there, doing its quiet little orbit thing."
  ]
};

const modal = document.querySelector('#message-modal');
const label = document.querySelector('#modal-label');
const title = document.querySelector('#modal-title');
const text = document.querySelector('#modal-message');
let activeMood = 'welcome';
let lastIndex = -1;

function pickMessage(mood) {
  const options = messages[mood];
  let index = Math.floor(Math.random() * options.length);
  if (options.length > 1 && index === lastIndex) index = (index + 1) % options.length;
  lastIndex = index;
  return options[index];
}

function showMessage(mood = 'welcome') {
  activeMood = mood;
  const distract = mood === 'distract';
  label.textContent = distract ? 'a lovely little detour' : 'a small note for Ayesha';
  title.textContent = distract ? 'A pause, just for you.' : 'Here is a little something.';
  text.textContent = pickMessage(mood);
  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');
}

document.querySelector('#open-note').addEventListener('click', () => showMessage());
document.querySelector('#random-note').addEventListener('click', () => showMessage());
document.querySelector('#distract-me').addEventListener('click', () => showMessage('distract'));
document.querySelectorAll('.mood-card').forEach(card => card.addEventListener('click', () => showMessage(card.dataset.mood)));
document.querySelector('#another-note').addEventListener('click', () => showMessage(activeMood));
document.querySelector('#close-modal').addEventListener('click', closeModal);
modal.addEventListener('click', event => { if (event.target === modal) closeModal(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeModal(); });
function closeModal() { modal.classList.remove('is-open'); modal.setAttribute('aria-hidden', 'true'); }
