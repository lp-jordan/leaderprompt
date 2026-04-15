import test from 'node:test';
import assert from 'node:assert';
import {
  buildRollingTranscript,
  findNearestAnchorIndex,
  matchTranscriptToAnchors,
  normalizeText,
  selectHighlightToken,
  shouldCommitAlignment,
} from '../src/utils/speechAlignment.js';

function makeAnchor(index, text) {
  return {
    index,
    text,
    normalizedText: normalizeText(text),
    tokens: normalizeText(text).split(' ').filter(Boolean),
    element: { offsetTop: index * 100 },
  };
}

test('matchTranscriptToAnchors tracks steady forward reading', () => {
  const anchors = [
    makeAnchor(0, 'Welcome to LeaderPrompt.'),
    makeAnchor(1, 'We are going to walk through the workflow today.'),
    makeAnchor(2, 'This section explains how to save your script.'),
  ];

  const match = matchTranscriptToAnchors({
    anchors,
    transcript: 'walk through the workflow today',
    currentAnchorIndex: 0,
  });

  assert.strictEqual(match.matchedAnchor.index, 1);
  assert.strictEqual(match.direction, 'forward');
  assert.ok(match.confidence > 0.5);
});

test('matchTranscriptToAnchors can rewind to a restarted sentence', () => {
  const anchors = [
    makeAnchor(0, 'Start with the customer profile.'),
    makeAnchor(1, 'Then open the account settings page.'),
    makeAnchor(2, 'Finally save and send the update.'),
  ];

  const match = matchTranscriptToAnchors({
    anchors,
    transcript: 'start with the customer profile',
    currentAnchorIndex: 2,
  });

  assert.strictEqual(match.matchedAnchor.index, 0);
  assert.strictEqual(match.direction, 'rewind');
});

test('shouldCommitAlignment requires extra stability for rewind matches', () => {
  const rewindMatch = {
    matchedAnchor: { index: 1 },
    confidence: 0.72,
  };

  assert.strictEqual(
    shouldCommitAlignment({
      match: rewindMatch,
      currentAnchorIndex: 3,
      stableMatchCount: 1,
    }),
    false,
  );

  assert.strictEqual(
    shouldCommitAlignment({
      match: rewindMatch,
      currentAnchorIndex: 3,
      stableMatchCount: 2,
    }),
    true,
  );
});

test('buildRollingTranscript keeps the most recent transcript tail', () => {
  const text = buildRollingTranscript([
    'welcome to the demo',
    'today we are going to walk through',
    'the workflow step by step',
  ], 30);

  assert.match(text, /workflow step by step$/);
  assert.ok(text.length <= 30);
});

test('buildRollingTranscript merges overlapping transcript chunks', () => {
  const text = buildRollingTranscript([
    'today we are checking whether',
    'are checking whether the transcript stays',
    'whether the transcript stays aligned with the',
    'transcript stays aligned with the script',
  ], 180);

  assert.strictEqual(text, 'today we are checking whether the transcript stays aligned with the script');
});

test('overlapping transcript chunks still produce a committable match', () => {
  const anchors = [
    makeAnchor(0, 'Today we are checking whether the transcript stays aligned with the script.'),
  ];

  const rollingTranscript = buildRollingTranscript([
    'today we are checking whether',
    'are checking whether the transcript stays',
    'whether the transcript stays aligned with the',
    'transcript stays aligned with the script',
  ], 180);

  const match = matchTranscriptToAnchors({
    anchors,
    transcript: rollingTranscript,
    currentAnchorIndex: 0,
  });

  assert.ok(match.confidence >= 0.52);
  assert.strictEqual(
    shouldCommitAlignment({
      match,
      currentAnchorIndex: 0,
      stableMatchCount: 1,
    }),
    true,
  );
});
test('selectHighlightToken chooses a token that exists in the matched anchor', () => {
  const anchor = makeAnchor(1, 'We are going to walk through the workflow today.');

  const token = selectHighlightToken({
    transcript: 'today we are going to walk through the workflow step by step',
    anchor,
  });

  assert.strictEqual(token, 'workflow');
});

test('selectHighlightToken returns blank when transcript and anchor do not overlap', () => {
  const anchor = makeAnchor(2, 'Save the final version before sending.');

  const token = selectHighlightToken({
    transcript: 'customer profile and account settings',
    anchor,
  });

  assert.strictEqual(token, '');
});

test('findNearestAnchorIndex respects a custom eyeline ratio', () => {
  const anchors = [
    makeAnchor(0, 'One'),
    makeAnchor(1, 'Two'),
    makeAnchor(2, 'Three'),
  ];

  assert.strictEqual(findNearestAnchorIndex(anchors, 0, 300, 0.2), 1);
  assert.strictEqual(findNearestAnchorIndex(anchors, 0, 300, 0.7), 2);
});

test('matchTranscriptToAnchors exposes debug metadata for the best candidate', () => {
  const anchors = [
    makeAnchor(0, 'Welcome to LeaderPrompt.'),
    makeAnchor(1, 'We are going to walk through the workflow today.'),
  ];

  const match = matchTranscriptToAnchors({
    anchors,
    transcript: 'walk through the workflow today',
    currentAnchorIndex: 0,
  });

  assert.strictEqual(match.candidateIndex, 1);
  assert.strictEqual(match.selectedHighlightToken, 'today');
  assert.match(match.anchorTextSnippet, /workflow today/i);
});

