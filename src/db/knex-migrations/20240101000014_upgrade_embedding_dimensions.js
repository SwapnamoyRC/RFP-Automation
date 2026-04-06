exports.up = async function (knex) {
  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'product_embeddings' AND column_name = 'embedding'
      ) THEN
        ALTER TABLE product_embeddings ALTER COLUMN embedding TYPE vector(3072);
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'product_family_embeddings' AND column_name = 'embedding'
      ) THEN
        ALTER TABLE product_family_embeddings ALTER COLUMN embedding TYPE vector(3072);
      END IF;
    END $$
  `);

  await knex.raw("ALTER TABLE product_embeddings ALTER COLUMN model SET DEFAULT 'text-embedding-3-large'");
  await knex.raw("ALTER TABLE product_family_embeddings ALTER COLUMN model SET DEFAULT 'text-embedding-3-large'");
};

exports.down = async function (knex) {
  await knex.raw("ALTER TABLE product_family_embeddings ALTER COLUMN model SET DEFAULT 'text-embedding-3-small'");
  await knex.raw("ALTER TABLE product_embeddings ALTER COLUMN model SET DEFAULT 'text-embedding-3-small'");
  // Note: downgrading vector dimensions would truncate data — skipping dimension revert
};
