// Shared scheduling/recommendation logic, used by poll.html (participant +
// organizer views). Kept identical to the reviewed prototype logic.

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
  return n.trim().replace(/\s+/g, " ").toLowerCase();
}

function hasFirstAndLast(n) {
  return normalizeName(n).split(" ").filter(Boolean).length >= 2;
}

function mustAttendStatus(slotId, responses, mustAttendList, linkedMustAttend) {
  // A must-attend person's availability is read from whichever participant
  // record is linked to them (exact match or organizer/manual link).
  const unavailable = [];
  const unknown = [];
  mustAttendList.forEach((maName) => {
    const linkedParticipant = Object.keys(linkedMustAttend).find(
      (p) => linkedMustAttend[p] === maName
    );
    if (!linkedParticipant) {
      unknown.push(maName);
      return;
    }
    const r = responses[linkedParticipant] && responses[linkedParticipant][slotId];
    if (r === "no") unavailable.push(maName);
    else if (!r) unknown.push(maName);
  });
  return { allAvailable: unavailable.length === 0, unavailable, unknown };
}

function compromiseScore(t) {
  return t.yes * 2 + t.ifNeeded * 1;
}

function computeRecommendations(slots, responses, participants, mustAttendList, linkedMustAttend) {
  const withTally = slots.map((s) => ({
    ...s,
    tally: tally(s.id, responses, participants),
    must: mustAttendStatus(s.id, responses, mustAttendList, linkedMustAttend),
  }));

  if (withTally.length === 0) {
    return { withTally: [], mostPopular: null, mostInclusive: null, bestCompromise: null, recommended: null, noFullyEligible: false, closestAlternatives: [] };
  }

  const mostPopular = [...withTally].sort((a, b) => b.tally.yes - a.tally.yes)[0];

  const mostInclusive = [...withTally].sort((a, b) => {
    if (a.tally.no !== b.tally.no) return a.tally.no - b.tally.no;
    return b.tally.yes - a.tally.yes;
  })[0];

  const bestCompromise = [...withTally].sort(
    (a, b) => compromiseScore(b.tally) - compromiseScore(a.tally)
  )[0];

  const eligible = withTally.filter((s) => s.must.allAvailable);
  let recommended = null;
  let noFullyEligible = false;

  if (mustAttendList.length === 0) {
    recommended = bestCompromise;
  } else if (eligible.length > 0) {
    recommended = [...eligible].sort(
      (a, b) => compromiseScore(b.tally) - compromiseScore(a.tally)
    )[0];
  } else {
    noFullyEligible = true;
  }

  const closestAlternatives = noFullyEligible
    ? [...withTally].sort((a, b) => {
        if (a.must.unavailable.length !== b.must.unavailable.length)
          return a.must.unavailable.length - b.must.unavailable.length;
        return compromiseScore(b.tally) - compromiseScore(a.tally);
      }).slice(0, 3)
    : [];

  return { withTally, mostPopular, mostInclusive, bestCompromise, recommended, noFullyEligible, closestAlternatives };
}

function badgesForSlot(slot, rec, mustAttendCount) {
  const badges = [];
  if (mustAttendCount > 0 && rec.recommended && slot.id === rec.recommended.id) {
    badges.push({ label: "★ Recommended", tone: "teal" });
  } else if (mustAttendCount === 0 && rec.recommended && slot.id === rec.recommended.id) {
    badges.push({ label: "★ Best overall", tone: "teal" });
  }
  if (rec.mostPopular && slot.id === rec.mostPopular.id) badges.push({ label: "Most Popular", tone: "neutral" });
  if (rec.mostInclusive && slot.id === rec.mostInclusive.id) badges.push({ label: "Most Inclusive", tone: "neutral" });
  if (rec.bestCompromise && slot.id === rec.bestCompromise.id) badges.push({ label: "Best Compromise", tone: "neutral" });
  return badges;
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = String(s);
  return d.innerHTML;
}

// ---------- Date / timezone helpers ----------
// Slots are stored as a single UTC instant (ISO string). Display is always
// computed at render time in whichever timezone is relevant — the viewer's
// own browser timezone by default, so a slot proposed at "10am Eastern"
// correctly shows as "7am Pacific" to someone on the west coast, the same
// way Doodle auto-adjusts per participant.

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
