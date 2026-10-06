using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace backend.Migrations
{
    /// <inheritdoc />
    public partial class Canvases : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            var sqlite = ActiveProvider == "Microsoft.EntityFrameworkCore.Sqlite";

            migrationBuilder.CreateTable(
                name: "Canvases",
                columns: table => new
                {
                    Id = table.Column<int>(type: sqlite ? "INTEGER" : "integer", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ProjectId = table.Column<long>(type: sqlite ? "INTEGER" : "bigint", nullable: false),
                    Name = table.Column<string>(type: sqlite ? "TEXT" : "character varying(120)", maxLength: 120, nullable: false),
                    CanvasJson = table.Column<string>(type: sqlite ? "TEXT" : "text", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: sqlite ? "TEXT" : "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: sqlite ? "TEXT" : "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Canvases", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Canvases_Projects_ProjectId",
                        column: x => x.ProjectId,
                        principalTable: "Projects",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            // Keep each project's existing canvas as its first canvas.
            migrationBuilder.Sql(
                "INSERT INTO \"Canvases\" (\"ProjectId\", \"Name\", \"CanvasJson\", \"CreatedAt\", \"UpdatedAt\") " +
                "SELECT \"Id\", 'General', \"CanvasJson\", \"CreatedAt\", \"CreatedAt\" FROM \"Projects\"");

            migrationBuilder.DropColumn(
                name: "CanvasJson",
                table: "Projects");

            migrationBuilder.CreateTable(
                name: "CanvasPermissions",
                columns: table => new
                {
                    CanvasId = table.Column<int>(type: sqlite ? "INTEGER" : "integer", nullable: false),
                    UserId = table.Column<string>(type: sqlite ? "TEXT" : "text", nullable: false),
                    CanRead = table.Column<bool>(type: sqlite ? "INTEGER" : "boolean", nullable: false),
                    CanWrite = table.Column<bool>(type: sqlite ? "INTEGER" : "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CanvasPermissions", x => new { x.CanvasId, x.UserId });
                    table.ForeignKey(
                        name: "FK_CanvasPermissions_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_CanvasPermissions_Canvases_CanvasId",
                        column: x => x.CanvasId,
                        principalTable: "Canvases",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Canvases_ProjectId",
                table: "Canvases",
                column: "ProjectId");

            migrationBuilder.CreateIndex(
                name: "IX_CanvasPermissions_UserId",
                table: "CanvasPermissions",
                column: "UserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CanvasPermissions");

            migrationBuilder.DropTable(
                name: "Canvases");

            migrationBuilder.AddColumn<string>(
                name: "CanvasJson",
                table: "Projects",
                type: ActiveProvider == "Microsoft.EntityFrameworkCore.Sqlite" ? "TEXT" : "text",
                nullable: false,
                defaultValue: "{\"view\":{\"x\":40,\"y\":40,\"zoom\":1},\"items\":[]}");
        }
    }
}
