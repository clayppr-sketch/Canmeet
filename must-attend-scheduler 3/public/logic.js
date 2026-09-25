// Shared scheduling/recommendation and display helpers.

function tally(slotId, responses, participants) {
  let yes = 0, ifNeeded = 0, no = 0;
  participants.forEach((p) => {
    const r = responses[p] && responses[p][slotId];
    if (r === "yes") yes++;
    else if (r === "if_needed") ifNeeded++;
    else if (r === "no") no++;
  });
  return { yes, ifNeeded, no, total: participants.length };
}

function normalizeName(n) {
  return String(n || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
}

function hasFirstAndLast(n) {
  return String(n || "").trim().replace(/\s+/g, " ").split(" ").filter(Boolean).length >= 2;
}

function mustAttendStatus(slotId, responses, mustAttendList, linkedMustAttend) {
  const unavailable = [];
  const unknown = [];
  const conditional = [];

  mustAttendList.forEach((maName) => {
    const linkedParticipant = Object.keys(linkedMustAttend || {}).find(
      (p) => normalizeName(linkedMustAttend[p]) === normalizeName(maName)
    );
    if (!linkedParticipant) {
      unknown.push(maName);
      return;
    }
    const r = responses[linkedParticipant] && responses[linkedParticipant][slotId];
    if (r === "no") unavailable.push(maName);
    else if (r === "if_needed") conditional.push(maName);
    else if (r !== "yes") unknown.push(maName);
  });

  return {
    allAvailable: unavailable.length === 0 && unknown.length === 0,
    unavailable,
    unknown,
    conditional,
  };
}

function compromiseScore(t) {
  return t.yes * 2 + t.ifNeeded;
}

function topBy(items, comparator) {
  if (!items.length) return [];
  const sorted = [...items].sort(comparator);
  const best = sorted[0];
  return sorted.filter((item) => comparator(item, best) === 0 && comparator(best, item) === 0);
}

function computeRecommendations(slots, responses, participants, mustAttendList, linkedMustAttend) {
  const withTally = slots.map((s) => ({
    ...s,
    tally: tally(s.id, responses, participants),
    must: mustAttendStatus(s.id, responses, mustAttendList, linkedMustAttend),
  }));

  if (withTally.length === 0) {
    return {
      withTally: [],
      mostPopular: null,
      mostPopularChoices: [],
      mostInclusive: null,
      mostInclusiveChoices: [],
      bestCompromise: null,
      bestCompromiseChoices: [],
      recommended: null,
      recommendedChoices: [],
      provisionalLeader: null,
      provisionalChoices: [],
      awaitingMustAttend: false,
      noFullyEligible: false,
      closestAlternatives: [],
    };
  }

  const mostPopularChoices = topBy(withTally, (a, b) => b.tally.yes - a.tally.yes);
  const mostInclusiveChoices = topBy(withTally, (a, b) => {
    if (a.tally.no !== b.tally.no) return a.tally.no - b.tally.no;
    return b.tally.yes - a.tally.yes;
  });
  const bestCompromiseChoices = topBy(
    withTally,
    (a, b) => compromiseScore(b.tally) - compromiseScore(a.tally)
  );

  const fullyEligible = withTally.filter((s) => s.must.allAvailable);
  let recommendedChoices = [];
  let provisionalChoices = [];
  let awaitingMustAttend = false;
  let noFullyEligible = false;

  if (mustAttendList.length === 0) {
    recommendedChoices = bestCompromiseChoices;
  } else if (fullyEligible.length > 0) {
    recommendedChoices = topBy(
      fullyEligible,
      (a, b) => compromiseScore(b.tally) - compromiseScore(a.tally)
    );
  } else {
    // A slot with no confirmed Must-Attend "No" could still become eligible
    // once its unanswered Must-Attend participants respond.
    const stillPossible = withTally.filter(
      (s) => s.must.unavailable.length === 0 && s.must.unknown.length > 0
    );
    if (stillPossible.length > 0) {
      awaitingMustAttend = true;
      provisionalChoices = topBy(
        stillPossible,
        (a, b) => compromiseScore(b.tally) - compromiseScore(a.tally)
      );
    } else {
      noFullyEligible = true;
    }
  }

  const closestAlternatives = noFullyEligible
    ? [...withTally]
        .sort((a, b) => {
          if (a.must.unavailable.length !== b.must.unavailable.length) {
            return a.must.unavailable.length - b.must.unavailable.length;
          }
          return compromiseScore(b.tally) - compromiseScore(a.tally);
        })
        .slice(0, 3)
    : [];

  return {
    withTally,
    mostPopular: mostPopularChoices[0] || null,
    mostPopularChoices,
    mostInclusive: mostInclusiveChoices[0] || null,
    mostInclusiveChoices,
    bestCompromise: bestCompromiseChoices[0] || null,
    bestCompromiseChoices,
    recommended: recommendedChoices.length === 1 ? recommendedChoices[0] : null,
    recommendedChoices,
    provisionalLeader: provisionalChoices.length === 1 ? provisionalChoices[0] : null,
    provisionalChoices,
    awaitingMustAttend,
    noFullyEligible,
    closestAlternatives,
  };
}

function badgesForSlot(slot, rec, mustAttendCount) {
  const badges = [];
  const includes = (arr) => (arr || []).some((x) => x.id === slot.id);

  if (includes(rec.recommendedChoices)) {
    if (mustAttendCount > 0) {
      badges.push({
        label: rec.recommendedChoices.length > 1 ? "★ Tied recommendation" : "★ Recommended",
        tone: "teal",
      });
    } else {
      badges.push({
        label: rec.recommendedChoices.length > 1 ? "★ Tied best overall" : "★ Best overall",
        tone: "teal",
      });
    }
  } else if (includes(rec.provisionalChoices)) {
    badges.push({
      label: rec.provisionalChoices.length > 1 ? "Tied leader so far" : "Leading so far",
      tone: "neutral",
    });
  }

  if (includes(rec.mostPopularChoices)) {
    badges.push({ label: rec.mostPopularChoices.length > 1 ? "Tied: Most Popular" : "Most Popular", tone: "neutral" });
  }
  if (includes(rec.mostInclusiveChoices)) {
    badges.push({ label: rec.mostInclusiveChoices.length > 1 ? "Tied: Most Inclusive" : "Most Inclusive", tone: "neutral" });
  }
  if (includes(rec.bestCompromiseChoices)) {
    badges.push({ label: rec.bestCompromiseChoices.length > 1 ? "Tied: Best Compromise" : "Best Compromise", tone: "neutral" });
  }
  return badges;
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = String(s == null ? "" : s);
  return d.innerHTML;
}

function escapeAttr(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand("copy");
  ta.remove();
  if (!ok) throw new Error("Clipboard unavailable");
}

function viewerTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function formatInZone(iso, timeZone) {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  });
}

function formatViewerLocal(iso) {
  return formatInZone(iso, viewerTimezone());
}

function isPastDeadline(deadlineIso) {
  if (!deadlineIso) return false;
  return new Date() > new Date(deadlineIso);
}
