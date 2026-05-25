INSERT INTO vibe_categories (id, name, sort) VALUES (1, '本日推荐', 1);

INSERT INTO vibe_products (id, category_id, title, description, image, sort, available)
VALUES ('p_001', 1, '开心果冰淇淋', '西西里进口开心果，浓郁坚果香气，低糖配方',
        '/images/default-goods-image.png', 1, 1);

INSERT INTO vibe_skus (product_id, name, price, stock, available, sort) VALUES
  ('p_001', '单球',  38.00, -1, 1, 1),
  ('p_001', '双球',  68.00, -1, 1, 2),
  ('p_001', '品尝装', 25.00, -1, 1, 3);
