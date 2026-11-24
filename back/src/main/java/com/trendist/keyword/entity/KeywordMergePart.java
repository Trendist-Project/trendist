package com.trendist.keyword.entity;

import jakarta.persistence.*;
import java.io.Serializable;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** 합성 키워드의 구성 원본 한 줄(4.44). 합성 키워드 × 원래(1성) 키워드. */
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@Entity
@Table(name = "keyword_merge_parts", indexes = @Index(name = "idx_keyword_merge_parts_part", columnList = "part_keyword_id"))
@IdClass(KeywordMergePart.Key.class)
public class KeywordMergePart {
    @Id @Column(name = "keyword_id") private Long keywordId;
    @Id @Column(name = "part_keyword_id") private Long partKeywordId;

    public KeywordMergePart(Long keywordId, Long partKeywordId) { this.keywordId = keywordId; this.partKeywordId = partKeywordId; }

    public record Key(Long keywordId, Long partKeywordId) implements Serializable {}
}
