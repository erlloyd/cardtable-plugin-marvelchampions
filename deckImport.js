/**
 * Marvel Champions deck import parser for MarvelCDB API.
 *
 * Runs in a Web Worker sandbox. Receives the raw API response
 * and full GameAssets, returns a ComponentSet.
 *
 * MarvelCDB API response format:
 * {
 *   name: string,
 *   investigator_code?: string,
 *   hero_code?: string,
 *   slots: { [cardCode: string]: quantity }
 * }
 *
 * Card metadata used (when available in asset pack):
 * - setCode: identifies which set a card belongs to (e.g. "spider_man_nemesis")
 * - typeCode: card category (e.g. "obligation", "encounter", "hero")
 */

// eslint-disable-next-line no-undef
self.parseDeckResponse = function (apiResponse, gameAssets) {
  var response = apiResponse;
  var slots = response.slots || {};
  var heroCode = response.investigator_code || response.hero_code;
  var cards = gameAssets.cards || {};

  var stacks = [];

  // Find the hero card and its setCode
  var heroCard = heroCode ? cards[heroCode] : null;
  var heroSetCode = heroCard ? heroCard.setCode : null;

  // Build hero identity stack
  if (heroCode && heroCard) {
    stacks.push({
      label: 'Hero',
      faceUp: true,
      cards: [heroCode],
      row: 0,
    });
  }

  // Build main deck from slots (excluding hero code)
  var mainDeckCards = [];
  var slotKeys = Object.keys(slots);
  for (var i = 0; i < slotKeys.length; i++) {
    var code = slotKeys[i];
    var qty = slots[code];
    if (code === heroCode) continue;
    for (var j = 0; j < qty; j++) {
      mainDeckCards.push(code);
    }
  }

  if (mainDeckCards.length > 0) {
    stacks.push({
      label: 'Player Deck',
      faceUp: false,
      cards: mainDeckCards,
      row: 0,
    });
  }

  // Extract nemesis and obligation decks (requires setCode/typeCode on cards)
  if (heroSetCode) {
    var nemesisSetCode = heroSetCode + '_nemesis';
    // Also try without _hero suffix (e.g. "spider_man" → "spider_man_nemesis")
    var altNemesisSetCode = heroSetCode.replace('_hero', '') + '_nemesis';

    var nemesisCards = [];
    var obligationCards = [];
    var allCardCodes = Object.keys(cards);

    for (var k = 0; k < allCardCodes.length; k++) {
      var cardCode = allCardCodes[k];
      var card = cards[cardCode];
      if (!card.setCode) continue;

      var isNemesisSet =
        card.setCode === nemesisSetCode ||
        card.setCode === altNemesisSetCode;
      var isHeroSet = card.setCode === heroSetCode;

      if (isNemesisSet || isHeroSet) {
        if (card.typeCode === 'obligation') {
          obligationCards.push(cardCode);
        } else if (isNemesisSet && card.typeCode !== 'hero' && card.typeCode !== 'alter_ego') {
          nemesisCards.push(cardCode);
        }
      }
    }

    if (nemesisCards.length > 0) {
      stacks.push({
        label: 'Nemesis',
        faceUp: false,
        cards: nemesisCards,
        row: 1,
      });
    }

    if (obligationCards.length > 0) {
      stacks.push({
        label: 'Obligation',
        faceUp: false,
        cards: obligationCards,
        row: 1,
      });
    }
  }

  return {
    stacks: stacks,
  };
};
