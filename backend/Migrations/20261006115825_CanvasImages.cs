using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace backend.Migrations
{
    /// <inheritdoc />
    public partial class CanvasImages : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            var sqlite = ActiveProvider == "Microsoft.EntityFrameworkCore.Sqlite";

            migrationBuilder.CreateTable(
                name: "CanvasImages",
                columns: table => new
                {
                    Id = table.Column<int>(type: sqlite ? "INTEGER" : "integer", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    CanvasId = table.Column<int>(type: sqlite ? "INTEGER" : "integer", nullable: false),
                    ContentType = table.Column<string>(type: sqlite ? "TEXT" : "text", nullable: false),
                    Data = table.Column<byte[]>(type: sqlite ? "BLOB" : "bytea", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: sqlite ? "TEXT" : "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CanvasImages", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CanvasImages_Canvases_CanvasId",
                        column: x => x.CanvasId,
                        principalTable: "Canvases",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CanvasImages_CanvasId",
                table: "CanvasImages",
                column: "CanvasId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CanvasImages");
        }
    }
}
