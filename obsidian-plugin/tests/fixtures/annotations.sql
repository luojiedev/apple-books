CREATE TABLE ZAEANNOTATION (
  Z_PK INTEGER PRIMARY KEY, ZANNOTATIONUUID TEXT, ZANNOTATIONTYPE INTEGER,
  ZANNOTATIONSTYLE INTEGER, ZANNOTATIONISUNDERLINE INTEGER, ZANNOTATIONSELECTEDTEXT TEXT,
  ZANNOTATIONNOTE TEXT, ZANNOTATIONLOCATION TEXT, ZANNOTATIONCREATIONDATE REAL,
  ZANNOTATIONMODIFICATIONDATE REAL, ZANNOTATIONASSETID TEXT, ZANNOTATIONDELETED INTEGER
);
INSERT INTO ZAEANNOTATION VALUES
  (1, 'fixture-highlight-one', 2, 3, 0, '把一页书读慢一点，让一个念头在日常生活里多停留一会儿。', '阅读之后，给自己留五分钟不输入任何新信息。', 'epubcfi(/6/2!/4/2)', 805000000, 805000000, 'fixture-book-one', 0),
  (2, 'fixture-highlight-two', 2, 1, 0, '书里的答案很多，属于自己的问题却要慢慢找到。', '', 'epubcfi(/6/4!/4/2)', 808000000, 808000000, 'fixture-book-one', 0),
  (3, 'fixture-highlight-three', 2, 3, 0, '读完一本书，也可以只是带走一个更好的问题。', '下次读书会可以从一个问题开始。', 'epubcfi(/6/2!/4/2)', 805000000, 805000000, 'fixture-book-two', 0),
  (4, 'fixture-position', 3, 0, 0, '', '', 'epubcfi(/6/4)', 809000000, 809000000, 'fixture-book-one', 0),
  (5, 'fixture-deleted', 2, 1, 0, '已删除的批注不可导入。', '', 'epubcfi(/6/4)', 809000000, 809000000, 'fixture-book-one', 1);
