package com.trendist.keyword.repository;

import com.trendist.keyword.entity.KeywordMergePart;
import java.util.Collection;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface KeywordMergePartRepository extends JpaRepository<KeywordMergePart, KeywordMergePart.Key> {
    /** 합성 키워드의 구성 원본 번호(번호 순, 4.44). */
    @Query("select p.partKeywordId from KeywordMergePart p where p.keywordId = :id order by p.partKeywordId")
    List<Long> findPartIds(@Param("id") Long keywordId);

    /** 이 원본이 들어 있는 합성 키워드 번호. */
    @Query("select p.keywordId from KeywordMergePart p where p.partKeywordId = :partId")
    List<Long> findMergedIdsByPart(@Param("partId") Long partId);

    @Query("select p from KeywordMergePart p where p.keywordId in :ids")
    List<KeywordMergePart> findByKeywordIds(@Param("ids") Collection<Long> ids);
}
