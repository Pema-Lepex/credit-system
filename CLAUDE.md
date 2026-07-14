You are a Senior Full Stack Software Architect and Senior Software Engineer.

Your task is to DESIGN and BUILD a production-ready full-stack Credit Management System from scratch inside my existing VS Code workspace.

IMPORTANT:
- Do NOT ask me to build parts manually.
- Generate the complete project.
- Think through the architecture before writing code.
- Keep the code clean, modular, scalable, and well documented.
- Follow modern best practices.
- Whenever you make an important architectural decision, briefly explain it in comments or documentation.
- Build everything inside ONE repository.

===========================================================
PROJECT GOAL
===========================================================

This application is a Credit Management System for small businesses such as:

- Grocery shops
- Restaurants
- Cafes
- Pharmacies
- Clothing stores
- Hardware stores
- Repair shops
- Personal lending
- Any business that gives goods or money on credit.

The application should allow business owners to record customers who have taken goods, services, or cash on credit and remind both the owner and the customer before the payment due date.

This is NOT an accounting software.

It is a credit tracking and reminder system.

===========================================================
TECH STACK
===========================================================

Frontend
---------
- Next.js 15+
- App Router
- TypeScript
- Tailwind CSS v4
- Framer Motion
- Lucide Icons
- React Hook Form
- Zod Validation
- TanStack Table
- Recharts
- Responsive Design

Backend
--------
- Python
- FastAPI
- SQLModel
- Strawberry GraphQL
- GraphQL API
- APScheduler for reminders

===========================================================
DATABASE & STORAGE
===========================================================

Since I cannot currently afford paid hosting or paid database services, design the application using a storage layer that is lightweight, modular, and easy to migrate in the future.

Primary Development Database
----------------------------
- SQLite
- Store the database inside:
  /database/app.db

The database layer must be abstracted so that migrating later to PostgreSQL, Turso, Supabase, or another SQL database requires minimal code changes.

Storage Requirements
--------------------
- Store uploaded files locally during development.
- Separate uploads by business.
- Use unique filenames.
- Prevent duplicate uploads.
- Compress images before saving.
- Never store duplicate files.
- Organize uploads into folders.

Example:

uploads/
    businesses/
    customers/
    invoices/
    receipts/
    temp/

The application must support replacing local storage with Cloud Storage (S3, Cloudflare R2, Supabase Storage, etc.) later without rewriting the application.

Never tightly couple storage to business logic.

===========================================================
PROJECT STRUCTURE
===========================================================

Use a monorepo.

/
    frontend/
    backend/
    database/
    uploads/
    docs/
    README.md

===========================================================
AUTHENTICATION
===========================================================

Implement authentication.

Roles

- Super Admin
- Admin
- Staff

Login

Forgot Password

JWT Authentication

Protected Routes

Permissions

===========================================================
ADMIN CMS
===========================================================

Create a beautiful CMS dashboard.

The admin should be able to manage everything.

===========================================================
BUSINESS PROFILE
===========================================================

Business Information

Business Name

Logo

Email

Phone Number

WhatsApp Number

Address

Google Maps Location

Latitude

Longitude

Website

Facebook

Instagram

TikTok

Business Description

Working Hours

Currency

Timezone

Tax Percentage

Reminder Preferences

===========================================================
CUSTOMER MANAGEMENT
===========================================================

Store

Customer Name

Phone

Email

Address

Location

Profile Picture

Notes

Customer ID

Customer Status

Credit Score (internal)

Emergency Contact

===========================================================
PRODUCTS / SERVICES
===========================================================

Products

SKU

Barcode

Price

Category

Images

Description

Current Stock

Service List

Service Price

===========================================================
CREDIT MANAGEMENT
===========================================================

Core feature.

Admin can create a credit record.

Each record includes

Customer

Items purchased

Quantity

Price

Discount

Tax

Grand Total

Amount Paid

Remaining Amount

Due Date

Reminder Date

Status

Pending

Partially Paid

Paid

Overdue

Cancelled

Notes

Photo Attachment

Invoice Attachment

===========================================================
PAYMENT HISTORY
===========================================================

Every payment must create a history.

Amount

Date

Method

Reference

Notes

Remaining Balance

===========================================================
DASHBOARD
===========================================================

Modern dashboard with beautiful charts.

Cards

Total Customers

Total Credits

Overdue Credits

Today's Due

Total Revenue

Pending Revenue

Monthly Collections

Charts

Monthly Credit

Collections

Overdue Trend

Top Customers

Latest Transactions

Upcoming Due Dates

===========================================================
SEARCH
===========================================================

Global search.

Search by

Customer

Phone

Invoice

Credit Number

Business Name

===========================================================
FILTERS
===========================================================

Filter by

Paid

Pending

Overdue

Date

Customer

Amount

===========================================================
REPORTS
===========================================================

Generate reports.

Daily

Weekly

Monthly

Yearly

Export

CSV

Excel

PDF

===========================================================
REMINDER SYSTEM
===========================================================

This is the most important feature.

The system should automatically remind

Business Owner

AND

Customer

before the due date.

Reminder options

Email

Future-ready for SMS

Future-ready for WhatsApp

Allow reminders

1 day before

3 days before

7 days before

Custom

===========================================================
EMAIL SYSTEM
===========================================================

I am using the FREE W3Forms email service.

Do NOT hardcode email templates.

The email templates must be editable from the Admin Panel.

Admin can edit

Subject

Body

Footer

Business Name

Logo

Signature

Colors

Variables

Example variables

{{customer_name}}

{{amount}}

{{due_date}}

{{business_name}}

{{phone}}

{{remaining}}

{{payment_link}}

Create separate templates for

Reminder

Receipt

Payment Confirmation

Welcome

Admin Notification

===========================================================
NOTIFICATIONS
===========================================================

Notification center.

Unread

Read

Archived

Email Sent

Reminder Sent

Payment Received

===========================================================
FILES
===========================================================

Upload

Customer Photo

Invoice

Receipt

Store locally.

===========================================================
STORAGE OPTIMIZATION
===========================================================

The application must be designed to minimize storage usage even if thousands of businesses and millions of records are stored.

Storage Optimization Rules

• Normalize the database properly.
• Never duplicate customer information.
• Use IDs instead of repeating data.
• Compress uploaded images automatically.
• Do not permanently store generated PDFs.
• Generate invoices and receipts only when the user requests a download.
• Remove temporary export files automatically.
• Remove orphaned files automatically.
• Store thumbnails instead of full-resolution previews whenever possible.
• Cache only when necessary.
• Use pagination for every large table.
• Use lazy loading throughout the application.
• Optimize GraphQL queries to avoid unnecessary data fetching.

The application should remain fast even with large datasets.

===========================================================
DATA RETENTION POLICY
===========================================================

Because storage is limited, every business should have a configurable data retention policy.

Default Retention

30 Days

The admin can change this to

• 30 Days
• 60 Days
• 90 Days
• Never Delete

The retention period applies only to completed and inactive credit records.

Before deleting any data:

1. Archive the records.
2. Notify the business owner.
3. Allow the owner to download the records.
4. Wait until the retention period expires.
5. Permanently delete the archived records.

Nothing should be deleted immediately.

All deletion operations must be logged.

===========================================================
AUTOMATIC REMINDERS BEFORE DATA DELETION
===========================================================

Before archived data is permanently deleted, automatically notify the business owner.

Notification Schedule

• 7 Days Before Deletion
• 3 Days Before Deletion
• 1 Day Before Deletion

Notifications should appear

• Inside the Dashboard
• By Email

The reminder should include

• Number of records
• Storage used
• Scheduled deletion date
• Download button

The business owner must have the ability to postpone deletion if desired.

===========================================================
DATA EXPORT
===========================================================

Before data is deleted, the business owner must be able to download all archived records.

Supported Formats

• Excel (.xlsx)
• CSV
• JSON

Exports should include

Customers

Credit Records

Payments

Products

Services

Reports

Business Information

Exported files should automatically expire after 24 hours to save storage.

===========================================================
STORAGE DASHBOARD
===========================================================

Create a Storage Dashboard inside Settings.

Display

Database Size

Upload Size

Images

Reports

Exports

Logs

Temporary Files

Total Storage Used

Also display

Number of Customers

Number of Credit Records

Number of Businesses

Number of Images

Number of Reports

Provide

Clean Storage

Delete Temporary Files

Run Database Optimization

Vacuum SQLite Database

Archive Old Records

Download Database Backup

The Storage Dashboard should help businesses manage storage efficiently.

===========================================================
DATABASE OPTIMIZATION
===========================================================

Implement automatic maintenance tasks.

Daily

• Remove temporary files
• Remove expired exports
• Remove expired cache

Weekly

• Optimize SQLite
• Vacuum Database
• Analyze Database
• Clean Logs

Monthly

• Archive old records
• Compress historical data
• Verify database integrity

These maintenance jobs should run automatically using APScheduler.

===========================================================
SETTINGS
===========================================================

Theme

Language

Currency

Timezone

Logo

Business Details

Reminder Settings

Email Settings

===========================================================
UI / UX
===========================================================

Design something that looks premium.

Inspired by

Stripe Dashboard

Linear

Vercel

Notion

Tailwind UI

Requirements

Modern

Minimal

Elegant

Animations

Rounded Cards

Soft Shadows

Glass Effects where appropriate

Dark Mode

Light Mode

Fully Responsive

Desktop

Laptop

Tablet

Mobile

Large Screens

Ultra-wide Screens

Accessibility

===========================================================
GRAPHQL
===========================================================

Use GraphQL for

Queries

Mutations

Pagination

Filtering

Sorting

===========================================================
CODE QUALITY
===========================================================

Use

Reusable Components

Reusable Hooks

Reusable Services

Reusable GraphQL Queries

Feature-based architecture

No duplicated code

Strong TypeScript

Python type hints

Clean folder structure

===========================================================
DOCUMENTATION
===========================================================

Generate

README

Installation Guide

Deployment Guide

Architecture Diagram (Markdown)

API Documentation

Folder Explanation

===========================================================
DEPLOYMENT
===========================================================

The frontend should deploy directly to Vercel.

The backend should be structured so that later it can be deployed independently.

Use environment variables.

No secrets inside code.

===========================================================
FINAL REQUIREMENT
===========================================================

Build this project as if it were a commercial SaaS product.

Think like a senior software architect.

Do not simply generate code.

Design every feature for scalability, maintainability, security, responsiveness, and future cloud deployment.

Whenever a feature is completed:

• Verify it builds successfully.
• Fix all TypeScript errors.
• Fix all Python errors.
• Fix linting issues.
• Fix GraphQL errors.
• Test the feature.
• Continue automatically to the next feature.

Do not stop until the entire application is production-ready.

If an implementation choice could cause problems on Vercel (such as relying on persistent local storage), explain the limitation and implement the code so it can be switched to a proper cloud database or object storage with minimal changes.


Build this project as if it were a commercial SaaS product.