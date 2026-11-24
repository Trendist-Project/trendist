package com.trendist.keyword.support;

import com.trendist.keyword.entity.Keyword;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.List;
import java.util.stream.Collectors;

/**
 * 합성 키워드의 정체성과 이름 규칙(4.44).
 * 구성 원본(1성) 키워드를 정규화 값의 사전순(같으면 번호순)으로 정렬해 이어 붙이므로 A+B와 B+A는 같은 키워드다.
 * 정체성(keywords.normalized)은 `~` + 정렬한 구성 번호의 SHA-1이라 어떤 검색어와도 만나지 않는다.
 */
public final class MergeKey {
    private MergeKey() {}

    public static final int MAX_TEXT_LENGTH = 20;

    public static final Comparator<Keyword> ORDER = Comparator.comparing(Keyword::getNormalized).thenComparing(Keyword::getId);

    public static List<Keyword> sorted(java.util.Collection<Keyword> parts) {
        return parts.stream().sorted(ORDER).toList();
    }

    /** 이어 붙인 표시 이름(입력한 표기 그대로, 구분자 없음). */
    public static String text(List<Keyword> sortedParts) {
        return sortedParts.stream().map(Keyword::getText).collect(Collectors.joining());
    }

    /** 화면에 보이는 이름: 구성 원본 이름을 띄어쓰기로 구분한다(keywords.text에는 글자 수 제한 때문에 붙여서 저장한다). */
    public static String display(List<Keyword> sortedParts) {
        return sortedParts.stream().map(Keyword::getText).collect(Collectors.joining(" + "));
    }

    /** 이어 붙인 정규화 값(금지어 포함 검사용). */
    public static String joinedNormalized(List<Keyword> sortedParts) {
        return sortedParts.stream().map(Keyword::getNormalized).collect(Collectors.joining());
    }

    /** keywords.normalized에 넣는 정체성 값. */
    public static String identity(List<Keyword> sortedParts) {
        String ids = sortedParts.stream().map(k -> String.valueOf(k.getId())).sorted(Comparator.comparingLong(Long::parseLong)).collect(Collectors.joining(","));
        try {
            return "~" + HexFormat.of().formatHex(MessageDigest.getInstance("SHA-1").digest(ids.getBytes(StandardCharsets.UTF_8)));
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    public static int length(String text) { return text.codePointCount(0, text.length()); }
}
