-- CreateTable
CREATE TABLE "detection_comparisons" (
    "id" BIGSERIAL NOT NULL,
    "source" TEXT NOT NULL,
    "segment" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "word_count" INTEGER NOT NULL,
    "external_engine" TEXT NOT NULL,
    "external_probability" DOUBLE PRECISION NOT NULL,
    "external_band" TEXT NOT NULL,
    "veritas_engine" TEXT NOT NULL,
    "veritas_probability" DOUBLE PRECISION NOT NULL,
    "veritas_band" TEXT NOT NULL,
    "agreement" DOUBLE PRECISION NOT NULL,
    "concordant" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "detection_comparisons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "detection_comparisons_segment_veritas_engine_idx" ON "detection_comparisons"("segment", "veritas_engine");

-- CreateIndex
CREATE INDEX "detection_comparisons_created_at_idx" ON "detection_comparisons"("created_at");
