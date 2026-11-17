// The 70 reminder messages, 4 personalities and greetings, copied verbatim from the Mac app
// (SipBuddy/Managers/MessageLibrary.swift and Models.swift) so every platform talks the same way.

export const PERSONALITIES = {
  friendlyFriend: { title: 'Friendly Friend', subtitle: 'Casual and caring', weights: { friendly: 4, caring: 3, workBreak: 2, motivational: 1 } },
  funnyBuddy: { title: 'Funny Buddy', subtitle: 'Playful and humorous', weights: { funny: 6, friendly: 1, workBreak: 1 } },
  motivationalCoach: { title: 'Motivational Coach', subtitle: 'Positive and energetic', weights: { motivational: 5, goal: 2, workBreak: 1 } },
  minimalAssistant: { title: 'Minimal Assistant', subtitle: 'Short and professional', weights: { minimal: 1 } },
};

const GROUPS = [
  ['friendly', [
    "Hey! Shall we drink some water?",
    "A little water break? 💧",
    "Just checking on you. Have you had some water?",
    "Hey! It's been a while. How about a glass of water?",
    "Time for a little water break. 💧",
    "Psst… your water glass misses you.",
    "Quick sip? I'll wait. 😊",
    "How about a refreshing glass of water right now?",
    "Hey there! A few sips would be lovely right about now.",
    "Let's grab some water together. Cheers! 🥤",
    "Friendly nudge: it's water time!",
    "Your water bottle is waving at you. 👋",
  ]],
  ['funny', [
    "Your plants are hydrated. What about you? 🌱",
    "Water is calling. Don't ignore it! 📞",
    "Your body isn't running on coffee alone! ☕️",
    "Your body called. It needs some hydration!",
    "Breaking news: local human forgets to drink water. Don't be that human. 📰",
    "H₂O my goodness, it's water time!",
    "Be like a fish. Stay near water. 🐟",
    "Even cacti drink water sometimes. 🌵",
    "This is your friendly neighbourhood water reminder. 🕸️",
    "Sip happens. Make it happen now.",
    "Water you waiting for? 💧",
    "I'd tell you a water joke, but it might not sink in. Have a sip first.",
  ]],
  ['motivational', [
    "One glass closer to your daily goal!",
    "Keep going. You're doing great! 💪",
    "Small habits create big changes.",
    "Every sip counts. Let's do this!",
    "Champions hydrate. Grab that glass! 🏆",
    "You've got this — one more glass!",
    "Consistency wins. Time for a sip.",
    "Fuel up! A glass of water and back to crushing it.",
    "Strong habits start with small sips.",
    "A little hydration can make your day better.",
  ]],
  ['caring', [
    "You've been busy. Take a moment for yourself.",
    "Remember to look after yourself. 💙",
    "A little break might feel good right now.",
    "Don't forget to take care of yourself!",
    "Hey, you haven't had water in a while. Everything okay?",
    "Pause, breathe, and take a sip. You deserve it.",
    "Be kind to yourself today — a glass of water is a good start.",
    "Just a gentle reminder that you matter. Have some water. 💙",
    "Take it easy for a minute. Water first, then back to it.",
    "Rest your eyes, stretch a little, and have a sip.",
  ]],
  ['workBreak', [
    "You've been working hard. Take a sip!",
    "Step away from the screen for a sec — water break! 🖥️",
    "Your inbox can wait 30 seconds. Water first.",
    "Between tasks? Perfect moment for a glass of water.",
    "Long meeting? Sneak in a sip. 🤫",
    "Save your work, grab some water, come back refreshed.",
    "Quick stretch and a sip before the next task?",
    "Your to-do list will still be there. Hydrate first! ✅",
  ]],
  ['goal', [
    "Let's complete today's hydration goal!",
    "Only {remaining} to go. You can do it!",
    "You're {percent} of the way there — keep it flowing!",
    "So close! {remaining} left to hit today's goal. 🎯",
    "Let's finish today's goal strong! 💪",
    "{consumed} down. Let's top it off!",
    "The finish line is in sight — {remaining} to go! 🏁",
    "One more glass and you're nearly there!",
  ]],
  ['minimal', [
    "Time to drink water.",
    "Hydration reminder.",
    "Water break.",
    "Drink a glass of water.",
    "Reminder: hydrate.",
    "{remaining} left for today.",
    "Scheduled water break.",
    "Time for a glass.",
    "Sip reminder.",
    "Stay hydrated.",
  ]],
];

export const MESSAGES = [];
GROUPS.forEach(([category, list]) => list.forEach(template => MESSAGES.push({ id: MESSAGES.length, category, template })));

const CATEGORY_ORDER = ['caring', 'friendly', 'funny', 'goal', 'minimal', 'motivational', 'workBreak'];

function pickCategory(personality, progress) {
  // Once you're well on the way, goal-focused messages show up more often.
  if (personality !== 'minimalAssistant' && progress >= 0.6 && progress < 1 && Math.random() < 0.4) return 'goal';
  const weights = PERSONALITIES[personality]?.weights || PERSONALITIES.friendlyFriend.weights;
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let roll = Math.floor(Math.random() * total);
  for (const c of CATEGORY_ORDER) {
    const w = weights[c] || 0;
    if (roll < w) return c;
    roll -= w;
  }
  return 'friendly';
}

export function render(template, ctx) {
  return template
    .replaceAll('{remaining}', ctx.remaining)
    .replaceAll('{consumed}', ctx.consumed)
    .replaceAll('{percent}', Math.round(ctx.progress * 100) + '%');
}

/** Picks the next message for a personality, never the same one twice in a row. */
export function nextMessage(personality, ctx, lastId) {
  const category = pickCategory(personality, ctx.progress);
  let pool = MESSAGES.filter(m => m.category === category && m.id !== lastId);
  if (!pool.length) pool = MESSAGES.filter(m => m.id !== lastId);
  const m = pool[Math.floor(Math.random() * pool.length)];
  return { id: m.id, text: render(m.template, ctx) };
}

function dayPart(d = new Date()) {
  const h = d.getHours();
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 22) return 'evening';
  return 'night';
}

export function greetingTitle(d = new Date()) {
  return { morning: 'Good morning! 👋', afternoon: 'Good afternoon! 👋', evening: 'Good evening! 👋', night: 'Hello, night owl 🌙' }[dayPart(d)];
}

export function greetingSubtitle(personality, d = new Date()) {
  const p = dayPart(d);
  if (personality === 'minimalAssistant') return "Let's stay hydrated today.";
  const table = {
    funnyBuddy: { morning: 'Rise and hydrate, sunshine!', afternoon: 'Halfway through the day. Still a sponge?', evening: 'Evening sips are the best sips.', night: 'Even night owls need water. 🦉' },
    motivationalCoach: { morning: "New day, new goal. Let's go! 💪", afternoon: 'Keep the momentum going!', evening: "Let's finish the day strong!", night: 'Rest well — tomorrow we go again.' },
    friendlyFriend: { morning: "Good morning! Let's start fresh.", afternoon: 'Hope your day is going well!', evening: "Let's finish the day strong!", night: "Don't stay up too late!" },
  };
  return (table[personality] || table.friendlyFriend)[p];
}
