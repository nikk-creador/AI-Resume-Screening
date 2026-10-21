"""Language-aware token normalization for lexical resume matching."""

from __future__ import annotations

from functools import lru_cache
import re


_TECH_TOKEN_PATTERN = re.compile(
    r"(?i)(?<!\w)(?:c\+\+|c#|\.net|node\.js|ci/cd|\w+(?:[+#][\w+#]*)?)(?!\w)"
)


@lru_cache(maxsize=1)
def _spacy_tokenizer():
    import spacy

    # A blank pipeline provides tokenization without downloading model weights.
    return spacy.blank("xx")


@lru_cache(maxsize=1)
def _nltk_tools():
    from nltk.stem.snowball import SnowballStemmer
    from nltk.tokenize import RegexpTokenizer

    return RegexpTokenizer(_TECH_TOKEN_PATTERN.pattern), SnowballStemmer("english")


def matching_tokens(text: str) -> list[str]:
    """Tokenize with spaCy, recover technical terms with NLTK/regex, and stem words."""
    try:
        doc = _spacy_tokenizer()(text)
        tokens = [token.text.casefold() for token in doc if not token.is_space and not token.is_punct]
    except Exception:
        # NLTK's regex tokenizer remains usable even if the spaCy package cannot load.
        tokenizer, _ = _nltk_tools()
        tokens = [token.casefold() for token in tokenizer.tokenize(text)]

    tokenizer, stemmer = _nltk_tools()
    # spaCy separates punctuation in terms such as C++, .NET, and CI/CD. Re-add
    # those complete terms so technical skills remain searchable as one token.
    technical_tokens = [
        token.casefold()
        for token in tokenizer.tokenize(text)
        if re.search(r"[^\w]", token, re.UNICODE)
    ]
    tokens.extend(technical_tokens)
    normalized = []
    for token in tokens:
        if re.fullmatch(r"[a-z]{2,}", token) or token == "r":
            normalized.append(stemmer.stem(token))
        elif token.isalpha() and len(token) >= 2:
            normalized.append(token)
        elif re.fullmatch(r"\d+(?:\.\d+)?", token) or re.search(r"[^\w]", token):
            normalized.append(token)
    return normalized
