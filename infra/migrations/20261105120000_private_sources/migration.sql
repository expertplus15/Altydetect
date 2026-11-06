-- CreateTable
CREATE TABLE "private_sources" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "word_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "private_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_fingerprints" (
    "id" BIGSERIAL NOT NULL,
    "source_id" TEXT NOT NULL,
    "hash" BIGINT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "source_fingerprints_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "private_sources_workspace_id_created_at_idx" ON "private_sources"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "source_fingerprints_hash_idx" ON "source_fingerprints"("hash");

-- CreateIndex
CREATE INDEX "source_fingerprints_source_id_idx" ON "source_fingerprints"("source_id");

-- AddForeignKey
ALTER TABLE "source_fingerprints" ADD CONSTRAINT "source_fingerprints_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "private_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
